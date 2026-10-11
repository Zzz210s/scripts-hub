// B站 HTTP:只用 cookie,不登录、不保存密码。fetchImpl 可注入,便于离线单测。
import fs from 'node:fs'
import { parseLenient } from './lenient-json.js'

const DEFAULT_TIMEOUT_MS = 10000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const URLS = {
    nav: 'https://api.bilibili.com/x/web-interface/nav',
    voucher: 'https://api.bilibili.com/x/vip/privilege/my',
    receive: 'https://api.bilibili.com/x/vip/privilege/receive',
    coin: 'https://account.bilibili.com/site/getCoin',
    followings: 'https://api.bilibili.com/x/relation/followings'
}

const match = (text, re) => re.exec(text)?.[1] ?? null

/** 从 cookies.json 的第 index 条里抽出 cookie 串、mid、csrf。绝不返回整份文件。 */
export function readCookie(cookiesFile, index = 0) {
    let text
    try {
        text = fs.readFileSync(cookiesFile, 'utf8')
    } catch {
        return null
    }
    // 上游 Console 用 Newtonsoft 写出的文件带尾逗号,严格 JSON.parse 会失败(2026-10-11 实测) —— 走容错解析
    const parsed = parseLenient(text)
    const list = parsed?.BiliBiliCookies
    if (!Array.isArray(list) || !list[index]) return null
    const cookie = String(list[index])
    return { cookie, mid: match(cookie, /DedeUserID=(\d+)/), csrf: match(cookie, /bili_jct=([^;]+)/) }
}

async function request(url, { cookie, deps = {}, method = 'GET', headers = {} } = {}) {
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    try {
        const res = await fetchImpl(url, {
            method,
            headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: cookie, ...headers },
            signal: controller.signal
        })
        const text = await res.text()
        if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 120)}` }
        let json
        try {
            json = JSON.parse(text)
        } catch {
            return { ok: false, error: `响应不是 JSON:${text.slice(0, 120)}` }
        }
        if (json?.code !== undefined && json.code !== 0) return { ok: false, error: `code=${json.code} ${json.message ?? json.msg ?? ''}`.trim(), code: json.code }
        return { ok: true, data: json }
    } catch (error) {
        return { ok: false, error: error?.name === 'AbortError' ? '请求超时' : (error?.message ?? String(error)) }
    } finally {
        clearTimeout(timer)
    }
}

export const fetchNav = (cookie, deps = {}) => request(URLS.nav, { cookie, deps })
export const fetchVoucher = (cookie, deps = {}) => request(URLS.voucher, { cookie, deps })
export const receiveVoucher = (cookie, csrf, deps = {}) =>
    request(`${URLS.receive}?type=1&csrf=${encodeURIComponent(csrf ?? '')}`, { cookie, deps, method: 'POST' })

const moneyOf = (payload) => {
    const value = payload?.data?.money
    return Number.isFinite(Number(value)) ? Number(value) : null
}

/** 硬币余额:getCoin 优先,失败回落 nav 的 money;都拿不到返回 ok:false(D14)。 */
export async function fetchCoin(cookie, deps = {}) {
    const primary = await request(URLS.coin, { cookie, deps, headers: { Referer: 'https://account.bilibili.com/' } })
    const direct = primary.ok ? moneyOf(primary.data) : null
    if (direct !== null) return { ok: true, data: { money: direct }, source: 'getCoin' }
    const nav = await fetchNav(cookie, deps)
    const fallback = nav.ok ? moneyOf(nav.data) : null
    if (fallback !== null) return { ok: true, data: { money: fallback }, source: 'nav' }
    return { ok: false, error: primary.error ?? '取不到硬币余额' }
}

/** 关注列表总数:data.total 优先,缺失回落 data.list.length(D13)。 */
export async function fetchFollowingsTotal(cookie, mid, deps = {}) {
    if (!mid) return { ok: false, error: '缺少 mid' }
    const result = await request(`${URLS.followings}?vmid=${encodeURIComponent(mid)}&pn=1&ps=1`, { cookie, deps })
    if (!result.ok) return { ok: false, error: result.error }
    const data = result.data?.data ?? {}
    const total = Number.isFinite(Number(data.total)) ? Number(data.total) : (Array.isArray(data.list) ? data.list.length : null)
    if (total === null) return { ok: false, error: '关注列表响应里既没有 total 也没有 list' }
    return { ok: true, total }
}
