// App 通道的凭据:用网页 cookie 里的长期凭证(wr_rt)换取 App 的 accessToken。
//
// 协议事实来自 teng-lin/weread-omni(MIT,电纸书客户端实现)的 docs/endpoints.md 与 src/auth/token.ts、
// src/profile.ts、src/device-ua.ts:
//   POST https://i.weread.qq.com/login
//   body: { deviceId, deviceName, inBackground:0, kickType:1, random, refCgi:"",
//           refreshToken, signature, timestamp, trackId:"", deviceType:3 }
//   signature = sha256(timestamp + deviceId + random)          (profile.refreshSignature)
//   设备头:baseapi / appver / basever / osver / channelId / User-Agent(电纸书 BOOX)
//   回包: { vid, accessToken, refreshToken, ... };之后请求带 headers { vid, accessToken }
//
// 只借用协议事实,不复制其代码;凭据只写本地 secrets/,不入库。
import { createHash, randomBytes, randomInt } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { writeJsonAtomic } from './atomic.js'
import { cookieToObject, parseCurl } from './auth.js'

export const APP_BASE = 'https://i.weread.qq.com'
export const DEVICE = {
    userAgent: 'WeRead/2.1.2 WRBrand/Onyx wr_eink Dalvik/2.1.0 (Linux; U; Android 11; BOOX Build/onyx)',
    baseapi: '30',
    appver: '2.1.2.10245900',
    osver: '11',
    channelId: '900',
    deviceName: 'BOOX',
    deviceType: 3
}

export function deviceHeaders() {
    return {
        baseapi: DEVICE.baseapi,
        appver: DEVICE.appver,
        basever: DEVICE.appver,
        osver: DEVICE.osver,
        channelId: DEVICE.channelId,
        'User-Agent': DEVICE.userAgent
    }
}

export function refreshSignature(timestamp, deviceId, random) {
    return createHash('sha256').update(`${timestamp}${deviceId}${random}`).digest('hex')
}

/** 电纸书风格的设备号(与 omni 的形态一致:前缀 + 19 位数字),生成一次后固定复用。 */
export function newDeviceId() {
    const digits = BigInt.asUintN(63, randomBytes(8).readBigUInt64BE()).toString().padStart(19, '0')
    return `eink334691225${digits}`
}

export function newInstallId() {
    return `eink31${Array.from({ length: 26 }, () => randomInt(10)).join('')}`
}

export function readWebCredentials(curlFile) {
    const parsed = parseCurl(fs.readFileSync(curlFile, 'utf8'))
    const cookie = cookieToObject(parsed.cookie)
    const vid = cookie.wr_vid ?? ''
    const refreshToken = decodeURIComponent(cookie.wr_rt ?? '')
    if (!vid || !refreshToken) throw new Error('网页 cookie 里缺少 wr_vid / wr_rt,无法换取 App 凭据')
    return { vid, refreshToken }
}

function loadJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
        return null
    }
}

/** 优先用 App 自己的凭据文件;没有时退回网页 cookie(后者实测换不到 App token)。 */
export function readAppCredentials(credentialsFile, curlFile) {
    if (credentialsFile && fs.existsSync(credentialsFile)) {
        const saved = loadJson(credentialsFile)
        if (saved?.refreshToken) return { vid: saved.vid, refreshToken: saved.refreshToken, deviceId: saved.deviceId, installId: saved.installId }
    }
    return readWebCredentials(curlFile)
}

/** 换取(或复用)App accessToken;token 存 secrets/app-token.json。 */
export async function ensureAppToken(options) {
    const { curlFile, tokenFile, credentialsFile, fetchImpl = globalThis.fetch, timeoutMs = 20000, force = false } = options
    const cached = loadJson(tokenFile)
    if (!force && cached?.accessToken && Date.now() - (cached.mintedAt ?? 0) < 6 * 3600 * 1000) {
        return { ok: true, reused: true, ...cached }
    }

    const { vid, refreshToken, deviceId: savedDeviceId, installId: savedInstallId } = readAppCredentials(credentialsFile, curlFile)
    const deviceId = savedDeviceId ?? cached?.deviceId ?? newDeviceId()
    const timestamp = Date.now()
    const random = randomInt(1, 1001)
    const body = {
        deviceId,
        deviceName: DEVICE.deviceName,
        inBackground: 0,
        kickType: 1,
        random,
        refCgi: '',
        refreshToken,
        signature: refreshSignature(timestamp, deviceId, random),
        timestamp,
        trackId: '',
        deviceType: DEVICE.deviceType
    }

    const response = await fetchImpl(`${APP_BASE}/login`, {
        method: 'POST',
        headers: { ...deviceHeaders(), 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
    })
    const text = await response.text()
    let payload = {}
    try {
        payload = JSON.parse(text)
    } catch { /* 非 JSON 按失败处理 */ }

    if (!payload.accessToken) {
        return { ok: false, error: `换取失败 HTTP ${response.status}:${text.slice(0, 200)}`, vid }
    }
    const record = {
        vid: payload.vid ?? vid,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken ?? refreshToken,
        deviceId,
        installId: savedInstallId ?? cached?.installId ?? newInstallId(),
        mintedAt: Date.now()
    }
    writeJsonAtomic(tokenFile, record)
    return { ok: true, reused: false, ...record }
}

export function appHeaders(token) {
    return { ...deviceHeaders(), vid: String(token.vid), accessToken: token.accessToken, 'content-type': 'application/json; charset=UTF-8' }
}

export function tokenPath(cwd) {
    return path.join(cwd, 'secrets', 'app-token.json')
}

/** App 自己的长期凭据(由 `node src/app-login.js qr|wait` 扫码生成),福利书币等 App 接口真正依赖的文件。 */
export function credentialsPath(cwd) {
    return path.join(cwd, 'secrets', 'app-credentials.json')
}

// CLI:node src/app-auth.js [--force]
if (process.argv[1]?.endsWith('app-auth.js')) {
    const cwd = process.cwd()
    const result = await ensureAppToken({
        curlFile: path.join(cwd, 'secrets', 'read-request.curl'),
        tokenFile: tokenPath(cwd),
        force: process.argv.includes('--force')
    })
    if (!result.ok) {
        console.log(`换取 App 凭据失败:${result.error}`)
        process.exitCode = 1
    } else {
        console.log(`${result.reused ? '复用已有' : '新换取'} App 凭据:vid=${result.vid} deviceId 长度=${String(result.deviceId).length} accessToken 长度=${String(result.accessToken).length}`)
    }
}

const TOKEN_EXPIRED_MARKERS = ['登录超时', '登录态失效', '-2012']

/**
 * App accessToken 实测比缓存期短:刚换到时能用,两小时后同一枚就报 401 -2012「登录超时」。
 * 这里从原始响应判断它是否已被服务端判失效(401/403 或带登录超时标记)。
 */
export function rawTokenExpired(raw) {
    if (!raw) return false
    if (raw.status === 401 || raw.status === 403) return true
    return TOKEN_EXPIRED_MARKERS.some(marker => String(raw.text ?? '').includes(marker))
}

/**
 * 用当前凭据跑一次;撞上失效就强制换一枚重试一次,并把(可能换过的)凭据带回去 ——
 * 调用方若之后还要接着用这枚凭据(例如领取后自证),必须用返回的 token,否则会再撞 401 而静默跳过。
 * 各接口把原始响应放在不同字段(`raw` / `queryRaw`),用 `rawOf` 取。
 */
export async function callWithRefresh({ token, tokenArgs, ensureToken, fn, rawOf = result => result?.raw }) {
    let active = token
    let result = await fn(active)
    if (result?.ok === false && rawTokenExpired(rawOf(result))) {
        const fresh = await ensureToken({ ...tokenArgs, force: true })
        if (fresh.ok) {
            active = fresh
            result = await fn(active)
        }
    }
    return { token: active, result }
}
