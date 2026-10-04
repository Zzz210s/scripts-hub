// 登录令牌的存储与判定:secrets/epic-tokens.json 的读写、access token 过期判定、
// 掩码与状态摘要。文件本身已 gitignore;写盘时尽量收紧权限。
import fs from 'node:fs'
import path from 'node:path'
import { readJsonSafe, writeAtomic } from './atomic.js'

export const TOKENS_VERSION = 1
export const ACCESS_SKEW_MS = 5 * 60 * 1000

const pick = (...values) => values.find((value) => typeof value === 'string' && value.length > 0) ?? ''

/** 把 Epic 的原始响应或已存的文件统一成 camelCase 结构;没有 access_token 视为无效。 */
export function normalizeTokens(raw, now = new Date()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const accessToken = pick(raw.access_token, raw.accessToken)
    if (!accessToken) return null
    return {
        version: TOKENS_VERSION,
        accountId: pick(raw.account_id, raw.accountId),
        displayName: pick(raw.displayName, raw.display_name),
        clientId: pick(raw.client_id, raw.clientId),
        accessToken,
        refreshToken: pick(raw.refresh_token, raw.refreshToken),
        accessExpiresAt: pick(raw.expires_at, raw.accessExpiresAt),
        refreshExpiresAt: pick(raw.refresh_expires_at, raw.refreshExpiresAt),
        savedAt: pick(raw.savedAt, now.toISOString())
    }
}

export function loadTokens(file) {
    const { value, error } = readJsonSafe(file, null)
    if (error) return { tokens: null, error }
    return { tokens: normalizeTokens(value), error: null }
}

export function saveTokens(file, tokens) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    writeAtomic(file, `${JSON.stringify(tokens, null, 2)}\n`)
    try {
        fs.chmodSync(file, 0o600) // Windows 上没有 POSIX 权限位,忽略失败
    } catch { /* 见上 */ }
}

/** access token 是否还能用;留 skewMs 余量,避免刚好卡在到期瞬间。 */
export function accessTokenValid(tokens, now = new Date(), skewMs = ACCESS_SKEW_MS) {
    const at = Date.parse(tokens?.accessExpiresAt ?? '')
    if (Number.isNaN(at)) return false
    return at - skewMs > now.getTime()
}

/** refresh token 是否已过期;给了时间才算,没给时间就不拦。 */
export function refreshTokenExpired(tokens, now = new Date()) {
    const at = Date.parse(tokens?.refreshExpiresAt ?? '')
    return !Number.isNaN(at) && at <= now.getTime()
}

/** 只留前后各几位;太短的一律全遮,绝不输出完整值。 */
export function maskToken(value) {
    const text = String(value ?? '')
    if (!text) return ''
    if (text.length <= 12) return '****'
    return `${text.slice(0, 6)}...${text.slice(-4)}`
}

export function tokenSummary(tokens, now = new Date()) {
    return {
        account: tokens?.displayName || tokens?.accountId || '',
        accessExpiresAt: tokens?.accessExpiresAt ?? '',
        refreshExpiresAt: tokens?.refreshExpiresAt ?? '',
        accessValid: accessTokenValid(tokens, now),
        hasRefresh: Boolean(tokens?.refreshToken),
        masked: maskToken(tokens?.accessToken)
    }
}
