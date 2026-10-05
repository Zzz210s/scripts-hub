// 会话注入:把 OAuth 的 access token 写成 EPIC_BEARER_TOKEN cookie,写进引擎用的
// 持久化 profile,让 Playwright 打开时已经是登录态。依据见 docs/auth.md:
// claabs/epicgames-freegames-node 的 puppet/base.ts 与 woctezuma/egs-15DaysofGames 的 auth_utils.py。
//
// 做法是先用 patchright 打开同一个 userDataDir、加 cookie、关掉 —— 持久化上下文会把
// cookie 落进 profile,随后引擎启动就能读到;不需要改动 vendor/ 里的上游脚本。
export const BEARER_COOKIE = 'EPIC_BEARER_TOKEN'
export const INJECT_DOMAINS = ['.epicgames.com', '.fortnite.com', '.unrealengine.com', '.twinmotion.com']

/** 写成引擎站点能识别的 cookie;取值就是 access_token 原样,含 eg1~ 前缀。 */
export function buildBearerCookies(accessToken, expiresAt) {
    const value = String(accessToken ?? '')
    const parsed = Date.parse(expiresAt ?? '')
    const expires = Math.floor((Number.isNaN(parsed) ? Date.now() + 3600000 : parsed) / 1000)
    return INJECT_DOMAINS.map((domain) => ({
        name: BEARER_COOKIE,
        value,
        domain,
        path: '/',
        expires,
        secure: true,
        httpOnly: true,
        sameSite: 'Lax'
    }))
}

/**
 * 打开持久化 profile、写入 cookie、关闭。launch 可注入以便离线测试;
 * 默认懒加载 patchright,没装引擎依赖时返回失败而不是抛。
 * 返回值 { ok, error? }:调用方失败时退化为「用 profile 里既有的会话」。
 */
export async function injectSession({ browserDir, accessToken, expiresAt, launch, headless = true, log } = {}) {
    if (!browserDir || !accessToken) return { ok: false, error: '缺少 browserDir 或 accessToken' }
    let launchContext = launch
    if (!launchContext) {
        try {
            const chromium = (await import('patchright')).chromium
            // 必须 bind:launchPersistentContext 是 BrowserType 的方法,拆下来单独调用时
            // 拿不到 this,patchright 内部读 this._playwright 就炸 —— 报错原文
            // 「Cannot read properties of undefined (reading '_playwright')」
            // (2026-10-05 服务器上第一次真跑踩到;本机从未跑过这条路,所以一直没暴露)
            launchContext = chromium.launchPersistentContext.bind(chromium)
        } catch (error) {
            return { ok: false, error: `patchright 不可用:${error?.message ?? error}` }
        }
    }
    let context
    try {
        context = await launchContext(browserDir, { headless })
        await context.addCookies(buildBearerCookies(accessToken, expiresAt))
        log?.('[登录] 已把 access token 注入持久化 profile')
        return { ok: true }
    } catch (error) {
        return { ok: false, error: error?.message ?? String(error) }
    } finally {
        try {
            await context?.close()
        } catch { /* 已经关闭 */ }
    }
}
