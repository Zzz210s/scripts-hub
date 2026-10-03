// 凭据体检与滚动续期。
//
// 机制(2026-10-01 实测):
//   POST https://weread.qq.com/web/login/renewal   body {"rq":"%2Fweb%2Fbook%2Fread","ql":false}
//   - ql=false 成功;ql=true 会返回 errCode -2013 鉴权失败;省略 ql 也成功
//   - 回包 {"succ":1},并在 Set-Cookie 里给出新的有效期:
//       wr_skey 1.5 小时、wr_rt / wr_vid / wr_pf 360 天(滚动)
//   所以只要定期续期并把结果落盘,会话就不会过期。
//
// 底座(weread-bot)每次会话开始也会续期,但它只在内存里用,不回写文件;这里补上落盘。
import fs from 'node:fs'
import path from 'node:path'

import { writeTextAtomic } from './atomic.js'

export const RENEW_URL = 'https://weread.qq.com/web/login/renewal'
export const USER_URL = 'https://weread.qq.com/web/user'
const PERSIST_COOKIES = ['wr_skey', 'wr_rt', 'wr_vid', 'wr_pf', 'wr_gid', 'wr_fp']

export function parseCurl(text) {
    const url = /--url '([^']+)'/.exec(text)?.[1] ?? ''
    const cookie = /-b '([^']+)'/.exec(text)?.[1] ?? ''
    const headers = {}
    for (const match of text.matchAll(/-H '([^:]+): ([^']*)'/g)) headers[match[1].toLowerCase()] = match[2]
    const body = /--data-raw '([\s\S]+)'\s*$/.exec(text.trim())?.[1] ?? ''
    return { url, cookie, headers, body }
}

export function cookieToObject(cookieString) {
    const out = {}
    for (const part of String(cookieString ?? '').split(';')) {
        const trimmed = part.trim()
        if (!trimmed) continue
        const eq = trimmed.indexOf('=')
        if (eq < 1) continue
        out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
    }
    return out
}

export function cookieToString(object) {
    return Object.entries(object).map(([key, value]) => `${key}=${value}`).join('; ')
}

/** 把 Set-Cookie 里的持久化字段合并进原 cookie(其余字段保持不动)。 */
export function mergeSetCookie(cookieString, setCookieList) {
    const merged = cookieToObject(cookieString)
    const changed = []
    for (const item of setCookieList) {
        const pair = String(item).split(';')[0].trim()
        const eq = pair.indexOf('=')
        if (eq < 1) continue
        const name = pair.slice(0, eq)
        const value = pair.slice(eq + 1)
        if (!PERSIST_COOKIES.includes(name)) continue
        if (merged[name] !== value) changed.push(name)
        merged[name] = value
    }
    return { cookie: cookieToString(merged), changed }
}

export function updateCookieInCurl(text, cookieString) {
    const next = text.replace(/-b '[^']*'/, `-b '${cookieString}'`)
    if (next === text) throw new Error('cURL 文件里找不到 -b \'...\' 形式的 cookie')
    return next
}

export function curlHeaders(parsed) {
    const headers = {
        accept: parsed.headers.accept ?? 'application/json, text/plain, */*',
        'user-agent': parsed.headers['user-agent'] ?? 'Mozilla/5.0',
        origin: 'https://weread.qq.com',
        referer: 'https://weread.qq.com/',
        cookie: parsed.cookie
    }
    return headers
}

/** 体检:拿一个需要登录的轻量接口试一下,能读到 userVid 就算有效。 */
export async function checkCredential({ curlFile, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
    const parsed = parseCurl(fs.readFileSync(curlFile, 'utf8'))
    const vid = cookieToObject(parsed.cookie).wr_vid ?? ''
    if (!vid) return { ok: false, reason: 'cookie 里没有 wr_vid' }
    try {
        const response = await fetchImpl(`${USER_URL}?userVid=${vid}`, {
            headers: curlHeaders(parsed),
            signal: AbortSignal.timeout(timeoutMs)
        })
        const text = await response.text()
        let payload = {}
        try {
            payload = JSON.parse(text)
        } catch { /* 非 JSON 一律按失效处理 */ }
        if (response.status === 200 && payload.userVid) return { ok: true, userVid: payload.userVid, name: payload.name ?? '' }
        return { ok: false, reason: `HTTP ${response.status} errCode=${payload.errCode ?? '-'} ${payload.errMsg ?? ''}`.trim() }
    } catch (error) {
        return { ok: false, reason: `请求失败:${error.message}` }
    }
}

/** 续期:成功后把新的 wr_skey / wr_rt 等原子回写进 cURL 文件。 */
export async function renewCookie({ curlFile, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
    const fileText = fs.readFileSync(curlFile, 'utf8')
    const parsed = parseCurl(fileText)
    const payloads = [{ rq: '%2Fweb%2Fbook%2Fread', ql: false }, { rq: '%2Fweb%2Fbook%2Fread', ql: true }, { rq: '%2Fweb%2Fbook%2Fread' }]
    const tried = []
    for (const payload of payloads) {
        try {
            const response = await fetchImpl(RENEW_URL, {
                method: 'POST',
                headers: { ...curlHeaders(parsed), 'content-type': 'application/json;charset=UTF-8' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(timeoutMs)
            })
            const text = await response.text()
            const setCookie = response.headers.getSetCookie?.() ?? []
            tried.push(`ql=${payload.ql ?? '未传'}:HTTP ${response.status}`)
            let ok = false
            try {
                ok = JSON.parse(text).succ === 1
            } catch { /* 非 JSON 视为失败 */ }
            if (!ok || !setCookie.length) continue
            const { cookie, changed } = mergeSetCookie(parsed.cookie, setCookie)
            if (changed.length) writeTextAtomic(curlFile, updateCookieInCurl(fileText, cookie))
            return { ok: true, changed, tried }
        } catch (error) {
            tried.push(`ql=${payload.ql ?? '未传'}:${error.message}`)
        }
    }
    return { ok: false, changed: [], tried }
}

/** 体检 + 需要时续期 + 再体检;返回最终状态,供运行流程决定跑还是不跑。 */
export async function ensureCredential(options) {
    const before = await checkCredential(options)
    if (before.ok) return { ok: true, renewed: false, changed: [], check: before }
    const renewal = await renewCookie(options)
    const after = await checkCredential(options)
    return {
        ok: after.ok,
        renewed: renewal.ok,
        changed: renewal.changed ?? [],
        tried: renewal.tried ?? [],
        check: after,
        firstFailure: before.reason,
        path: options.curlFile
    }
}

export function describeCredential(result) {
    if (result.ok && !result.renewed) return '凭据有效'
    if (result.ok) return `凭据续期成功 · 更新字段 ${result.changed.join(', ') || '仅刷新有效期'}`
    return `凭据失效:${result.check?.reason ?? '未知'}${result.firstFailure ? ` · 续期前 ${result.firstFailure} · 尝试 ${(result.tried ?? []).join(' / ')}` : ''}`
}

export function resolveCurlFile(cwd, configured) {
    return path.isAbsolute(configured) ? configured : path.join(cwd, configured)
}
