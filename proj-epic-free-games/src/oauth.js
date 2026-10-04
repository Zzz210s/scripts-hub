// Epic OAuth 客户端:设备授权、设备码换票、刷新令牌。只做 HTTP 形态与失败分类,
// 不碰文件系统;所有调用都可注入 fetch,测试离线。
//
// 端点与授权类型依据 proj-epic-free-games/docs/auth.md 的调研结论:
// - token 端点支持 client_credentials / device_code / refresh_token / exchange_code / device_auth
// - 设备授权要先拿 client_credentials 的 Bearer,再带 prompt=login 取 device_code
// 客户端是公开的应用凭据,不是用户秘密;与 claabs/epicgames-freegames-node 同源。
export const OAUTH_TOKEN_URL = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token'
export const OAUTH_DEVICE_URL = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/deviceAuthorization'
export const DEVICE_CLIENT = {
    id: '98f7e42c2e3a4f86a74eb43fbb41ed39',
    secret: '0a2449a2-001a-451e-afec-3e812901c4d7'
}
const REVOKED_ERRORS = new Set([
    'errors.com.epicgames.account.auth_token.invalid_refresh_token',
    'errors.com.epicgames.oauth.corrective_action_required'
])

/** OAuth 失败;kind 供上层决定「重试 / 重新登录 / 放弃」。 */
export class EpicAuthError extends Error {
    constructor(message, kind, meta = {}) {
        super(message)
        this.name = 'EpicAuthError'
        this.kind = kind
        Object.assign(this, meta)
    }
}

/**
 * 失败归类:
 * - pending  = 用户还没在浏览器里确认,继续轮询
 * - revoked  = 刷新令牌被吊销/失效,只能人工重新登录,重试无用
 * - network  = 网络或 5xx,可退避重试
 * - invalid  = 其它 4xx,重试无用
 */
export function classifyAuthFailure({ status = 0, errorCode = '', error } = {}) {
    if (errorCode === 'errors.com.epicgames.account.oauth.authorization_pending') return 'pending'
    if (REVOKED_ERRORS.has(errorCode)) return 'revoked'
    if (status === 401 || status === 403) return 'revoked'
    if (error || status >= 500) return 'network'
    if (status >= 400) return 'invalid'
    return 'unknown'
}

/** POST 表单到 Epic;非 2xx 抛 EpicAuthError,网络异常归为 network。 */
export async function postEpicForm(url, form, { fetchImpl = globalThis.fetch, client = DEVICE_CLIENT, bearer, timeoutMs = 20000 } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const authorization = bearer
            ? `Bearer ${bearer}`
            : `basic ${Buffer.from(`${client.id}:${client.secret}`).toString('base64')}`
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', authorization },
            body: new URLSearchParams(form).toString(),
            signal: controller.signal
        })
        const text = await response.text()
        let json = {}
        try {
            json = JSON.parse(text)
        } catch {
            json = {}
        }
        if (!response.ok) {
            const errorCode = json.errorCode ?? json.error ?? ''
            const kind = classifyAuthFailure({ status: response.status, errorCode })
            throw new EpicAuthError(json.errorMessage ?? `HTTP ${response.status}`, kind, { status: response.status, errorCode })
        }
        return json
    } catch (error) {
        if (error instanceof EpicAuthError) throw error
        throw new EpicAuthError(error?.message ?? String(error), 'network', { cause: error?.name })
    } finally {
        clearTimeout(timer)
    }
}

export const getClientCredentialsToken = (options = {}) =>
    postEpicForm(OAUTH_TOKEN_URL, { grant_type: 'client_credentials', token_type: 'eg1' }, options)

export const requestDeviceAuthorization = (options = {}) =>
    postEpicForm(`${OAUTH_DEVICE_URL}?prompt=login`, {}, options)

export const exchangeDeviceCode = ({ deviceCode, ...options } = {}) =>
    postEpicForm(OAUTH_TOKEN_URL, { grant_type: 'device_code', device_code: deviceCode }, options)

export const refreshAccessToken = ({ refreshToken, ...options } = {}) =>
    postEpicForm(OAUTH_TOKEN_URL, { grant_type: 'refresh_token', refresh_token: refreshToken, token_type: 'eg1' }, options)
