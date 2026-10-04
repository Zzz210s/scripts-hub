// App 通道登录(一次性):微信扫码换取 App 的 refreshToken / accessToken。
//
// 协议事实来自 teng-lin/weread-omni(MIT)的 src/auth/qrlogin.ts:
//   1. GET  https://i.weread.qq.com/wxticket?nonceStr=weread          -> { signature, timeStamp }
//   2. GET  https://open.weixin.qq.com/connect/sdk/qrconnect?...      -> { uuid }(扫码用的二维码内容)
//   3. GET  https://long.open.weixin.qq.com/connect/l/qrconnect?f=json&uuid=...
//        wx_errcode: 408 等待 / 404 已扫码 / 405 已确认(带 wx_code)/ 402 过期 / 403 拒绝
//   4. POST https://i.weread.qq.com/login  { code, isFromQrcode:1, deviceId, installId, ... }
//        -> { vid, accessToken, refreshToken }(长期有效,之后用 ensureAppToken 续期)
//
// 用法:
//   node src/app-login.js qr      生成二维码并保存 PNG(打印路径)
//   node src/app-login.js wait    等待扫码完成并保存凭据
import { createHash, randomInt } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { APP_BASE, DEVICE, credentialsPath, deviceHeaders, newDeviceId, newInstallId } from './app-auth.js'
import { writeJsonAtomic } from './atomic.js'

const WX_APPID = 'wxab9b71ad2b90ff34'
const SCOPE = 'snsapi_userinfo,snsapi_timeline,snsapi_friend'
const PENDING = (cwd) => path.join(cwd, 'secrets', 'app-login-pending.json')

function sign(timestamp, deviceId, random) {
    return createHash('sha256').update(`${timestamp}${deviceId}${random}`).digest('hex')
}

async function jsonFetch(url, init = {}, timeoutMs = 20000) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    const text = await response.text()
    let body = {}
    try {
        body = JSON.parse(text)
    } catch { /* 非 JSON 保留原文给报错用 */ }
    return { response, body, text }
}

export async function requestQr() {
    const ticket = await jsonFetch(`${APP_BASE}/wxticket?nonceStr=weread`, { headers: deviceHeaders() })
    if (!ticket.response.ok || typeof ticket.body.signature !== 'string') {
        throw new Error(`取二维码票据失败:HTTP ${ticket.response.status} ${ticket.text.slice(0, 150)}`)
    }
    const url = new URL('https://open.weixin.qq.com/connect/sdk/qrconnect')
    url.search = new URLSearchParams({
        appid: WX_APPID,
        noncestr: 'weread',
        timestamp: String(ticket.body.timeStamp),
        scope: SCOPE,
        signature: ticket.body.signature
    }).toString()
    const qr = await jsonFetch(url, { headers: { 'User-Agent': DEVICE.userAgent } })
    if (!qr.response.ok || qr.body.errcode !== 0 || typeof qr.body.uuid !== 'string') {
        throw new Error(`取二维码失败:HTTP ${qr.response.status} errcode=${qr.body.errcode} ${qr.text.slice(0, 150)}`)
    }
    return { uuid: qr.body.uuid, confirmUrl: `https://open.weixin.qq.com/connect/confirm?uuid=${encodeURIComponent(qr.body.uuid)}` }
}

/** 轮询到扫码确认为止;返回 wx_code。 */
export async function pollQr(uuid, { timeoutMs = 180000, intervalMs = 2000, onStatus } = {}) {
    const deadline = Date.now() + timeoutMs
    let scanned = false
    while (Date.now() < deadline) {
        const url = new URL('https://long.open.weixin.qq.com/connect/l/qrconnect')
        url.searchParams.set('f', 'json')
        url.searchParams.set('uuid', uuid)
        let body = {}
        try {
            ({ body } = await jsonFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 25000))
        } catch {
            await new Promise(resolve => setTimeout(resolve, intervalMs))
            continue
        }
        const code = Number(body.wx_errcode)
        if (code === 405 && typeof body.wx_code === 'string' && body.wx_code) {
            await onStatus?.('confirmed')
            return body.wx_code
        }
        if (code === 404 && !scanned) {
            scanned = true
            await onStatus?.('scanned')
        } else if (code === 402) {
            throw new Error('二维码已过期,请重新生成')
        } else if (code === 403) {
            throw new Error('扫码后被拒绝登录')
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
    throw new Error('等待扫码超时,请重新生成二维码')
}

export async function exchange(wxCode, deviceId) {
    const timestamp = Date.now()
    const random = randomInt(1000)
    const body = {
        appFirstInstall: 1,
        code: wxCode,
        deviceId,
        deviceName: DEVICE.deviceName,
        installId: newInstallId(),
        isAutoLogout: 0,
        isFromQrcode: 1,
        random,
        signature: sign(timestamp, deviceId, random),
        timestamp,
        trackId: '',
        deviceType: DEVICE.deviceType
    }
    const result = await jsonFetch(`${APP_BASE}/login`, {
        method: 'POST',
        headers: { ...deviceHeaders(), 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(body)
    }, 30000)
    const payload = result.body
    if (!result.response.ok || !payload.accessToken || !payload.refreshToken) {
        throw new Error(`换取 App 凭据失败:HTTP ${result.response.status} ${String(payload.errCode ?? payload.errcode ?? '')} ${String(payload.errMsg ?? payload.errmsg ?? '')} ${result.text.slice(0, 120)}`)
    }
    return { vid: String(payload.vid), accessToken: payload.accessToken, refreshToken: payload.refreshToken, deviceId, mintedAt: Date.now() }
}

// CLI
const cwd = process.cwd()
const mode = process.argv[2] ?? 'qr'
if (process.argv[1]?.endsWith('app-login.js')) {
    if (mode === 'qr') {
        const qr = await requestQr()
        writeJsonAtomic(PENDING(cwd), { ...qr, createdAt: new Date().toISOString() })
        console.log(`二维码内容已生成:`)
        console.log(`  confirmUrl = ${qr.confirmUrl}`)
        console.log(`  uuid 已存到 secrets/app-login-pending.json`)
    } else if (mode === 'wait') {
        const pending = JSON.parse(fs.readFileSync(PENDING(cwd), 'utf8'))
        const wxCode = await pollQr(pending.uuid, {
            onStatus: status => console.log(status === 'scanned' ? '已扫码,等待确认…' : '已确认,正在换取凭据…')
        })
        const credentials = await exchange(wxCode, newDeviceId())
        writeJsonAtomic(credentialsPath(cwd), credentials)
        console.log(`App 凭据已保存:vid=${credentials.vid} accessToken 长度=${credentials.accessToken.length} refreshToken 长度=${credentials.refreshToken.length}`)
    } else {
        console.log('用法:node src/app-login.js qr|wait')
    }
}
