// 探测:唯一会主动发 HTTP 的轻量入口。免费清单接口不需要登录,也不碰购买链路 ——
// 所以每天多跑几次是安全的;只有确认有没领过的项才启动浏览器引擎。
import { freeGamesUrl, parseFreeGames } from './promo.js'

/** 取免费清单并解析;任何失败都返回 { ok:false, error },不抛。 */
export async function probe({ config = {}, now = new Date(), fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
    const url = freeGamesUrl(config.locale, config.country)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } })
        if (!response.ok) return { ok: false, current: [], upcoming: [], error: `HTTP ${response.status}` }
        const text = await response.text()
        let json
        try {
            json = JSON.parse(text)
        } catch {
            return { ok: false, current: [], upcoming: [], error: '响应不是 JSON' }
        }
        return parseFreeGames(json, now)
    } catch (error) {
        return { ok: false, current: [], upcoming: [], error: error?.message ?? String(error) }
    } finally {
        clearTimeout(timer)
    }
}

export const probeUrl = (config = {}) => freeGamesUrl(config.locale, config.country)
