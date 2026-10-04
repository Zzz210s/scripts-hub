// 两种登录入口:
// - deviceLogin:设备授权(推荐)。跑一次,打印链接与验证码,人在浏览器确认一次,
//   程序拿到 access_token + refresh_token 存进 secrets/epic-tokens.json,之后纯自动续期。
// - profileLogin:退路。沿用浏览器的持久化 profile 人工登录一次,不保存密码。
// 依据见 docs/auth.md;两类调用都可注入,测试离线。
import { DEVICE_CLIENT, exchangeDeviceCode, getClientCredentialsToken, requestDeviceAuthorization } from './oauth.js'
import { normalizeTokens, saveTokens } from './tokens.js'

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 设备授权:拿 device_code -> 打印链接 -> 轮询 -> 落盘。超时/失败如实返回。 */
export async function deviceLogin({
    config,
    now = new Date(),
    fetchImpl,
    sleep = defaultSleep,
    client = DEVICE_CLIENT,
    log = () => {},
    pollIntervalMs,
    timeoutMs = 10 * 60 * 1000,
    clock = Date.now
} = {}) {
    let credentials
    let device
    try {
        credentials = await getClientCredentialsToken({ fetchImpl, client })
        device = await requestDeviceAuthorization({ bearer: credentials.access_token, fetchImpl, client })
    } catch (error) {
        return { ok: false, error: error?.message ?? String(error) }
    }
    const url = device.verification_uri_complete || device.verification_uri || ''
    log('请在浏览器里打开下面的链接并确认登录:')
    log(url)
    if (device.user_code) log(`验证码:${device.user_code}`)

    const ttl = Number.isFinite(device.expires_in) ? device.expires_in * 1000 : timeoutMs
    const deadline = clock() + Math.min(timeoutMs, ttl)
    const interval = pollIntervalMs ?? Math.max(5, device.interval ?? 5) * 1000
    while (clock() < deadline) {
        try {
            const session = await exchangeDeviceCode({ deviceCode: device.device_code, fetchImpl, client })
            const tokens = normalizeTokens(session, now)
            if (!tokens) return { ok: false, error: '设备授权返回的令牌不完整' }
            saveTokens(config.tokensFile, tokens)
            log(`登录成功:${tokens.displayName || tokens.accountId || 'Epic 账号'}`)
            return { ok: true, tokens }
        } catch (error) {
            if (error?.kind !== 'pending') return { ok: false, error: error?.message ?? String(error) }
            await sleep(interval)
        }
    }
    return { ok: false, error: '设备授权超时,请重跑 node src/cli.js login' }
}

/** 退路:跑一次引擎,放宽登录等待,让用户在浏览器里登录。 */
export async function profileLogin({ config, runEngine, log = () => {} } = {}) {
    log('打开浏览器让你登录一次;登录态落在持久化 profile 里,不保存密码。')
    const run = await runEngine({ config, env: { NOWAIT: '', LOGIN_TIMEOUT: '600' }, log })
    return { ok: run.code === 0, code: run.code }
}
