// 投币用的极薄 HTTP 层:统一 UA/Referer/Cookie,失败归一为 { ok:false, error, code },永不抛。
// 从 coin.js 抽出(2026-10-28,守 200 行上限);零依赖,只用内置 fetch。
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export const RANKING = 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all'
export const POPULAR = 'https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1'
export const COINS = (aid) => `https://api.bilibili.com/x/web-interface/archive/coins?aid=${encodeURIComponent(aid)}`
export const ADD = 'https://api.bilibili.com/x/web-interface/coin/add'

/**
 * 一次请求。超时用 AbortController,错误一律走返回值 —— 投币是尽力而为的一步,
 * 不该因为它把整次运行抛穿。
 */
export async function request(url, { cookie, deps = {}, method = 'GET', headers = {}, body } = {}) {
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10000)
    try {
        const res = await fetchImpl(url, {
            method,
            body,
            headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: cookie, ...headers },
            signal: controller.signal
        })
        const text = await res.text()
        if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 100)}` }
        let json
        try {
            json = JSON.parse(text)
        } catch {
            return { ok: false, error: `响应不是 JSON:${text.slice(0, 100)}` }
        }
        if (json?.code !== undefined && json.code !== 0) {
            return { ok: false, code: json.code, error: `code=${json.code} ${json.message ?? ''}`.trim() }
        }
        return { ok: true, data: json }
    } catch (error) {
        return { ok: false, error: error?.name === 'AbortError' ? '请求超时' : (error?.message ?? String(error)) }
    } finally {
        clearTimeout(timer)
    }
}
