// 登录态编排:读 token -> 过期就续期 -> 把会话注入持久化 profile。
// 只在这里决定「要不要人重新登录」;网络类失败与吊销类失败必须区分开。
import { injectSession } from './inject.js'
import { refreshAccessToken } from './oauth.js'
import { accessTokenValid, loadTokens, normalizeTokens, refreshTokenExpired, saveTokens } from './tokens.js'

export const BACKOFF_MS = [1000, 2000]

/** 刷新令牌;网络类失败退避重试,吊销/参数类失败立刻返回,不无限重试。 */
export async function refreshWithRetry({ tokens, fetchImpl, sleep, client, retries = 2 } = {}) {
    let last
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const fresh = await refreshAccessToken({ refreshToken: tokens.refreshToken, fetchImpl, client })
            return { ok: true, tokens: normalizeTokens({ ...tokens, ...fresh }) }
        } catch (error) {
            last = error
            const kind = error?.kind ?? 'network'
            if (kind !== 'network') return { ok: false, kind, error }
            if (attempt === retries) return { ok: false, kind: 'network', error }
            await sleep?.(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)])
        }
    }
    return { ok: false, kind: 'network', error: last }
}

/**
 * 运行前确保有可用会话。返回:
 * - { ok:true, mode:'profile' }   没有 token 文件,继续用浏览器 profile 的既有登录态
 * - { ok:true, mode:'token'|'refreshed', injected:boolean }  用 token,并已尝试注入
 * - { ok:false, needsLogin:true } refresh 被吊销,只能人工重新登录
 * - { ok:false, network:true }    网络类失败,重试过了,如实失败
 */
export async function ensureSession({ config, now = new Date(), fetchImpl, sleep, inject = injectSession, client, retries = 2, log } = {}) {
    const { tokens, error } = loadTokens(config.tokensFile)
    if (error) {
        log?.(`[登录] ${error};退回浏览器 profile`)
        return { ok: true, mode: 'profile', warn: error }
    }
    if (!tokens) return { ok: true, mode: 'profile' }

    let active = tokens
    let mode = 'token'
    if (!accessTokenValid(tokens, now)) {
        if (!tokens.refreshToken) return { ok: false, needsLogin: true, kind: 'revoked', error: 'access token 已过期且没有 refresh_token' }
        if (refreshTokenExpired(tokens, now)) return { ok: false, needsLogin: true, kind: 'revoked', error: 'refresh_token 已过期' }
        const result = await refreshWithRetry({ tokens, fetchImpl, sleep, client, retries })
        if (!result.ok) {
            return {
                ok: false,
                kind: result.kind,
                needsLogin: result.kind === 'revoked',
                network: result.kind === 'network',
                error: result.error?.message ?? String(result.error)
            }
        }
        active = result.tokens
        saveTokens(config.tokensFile, active)
        mode = 'refreshed'
        log?.('[登录] access token 已自动续期')
    }

    const injected = await inject({ browserDir: config.browserDir, accessToken: active.accessToken, expiresAt: active.accessExpiresAt, log })
    if (injected.ok) return { ok: true, mode, injected: true, tokens: active }
    return { ok: true, mode, injected: false, warn: `会话注入失败,退回 profile:${injected.error}`, tokens: active }
}
