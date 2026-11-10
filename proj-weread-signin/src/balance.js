// 书币余额:微信读书钱包里的书币。
//
// 接口来自 2026-10-02 实测(见 docs/superpowers/specs/2026-10-02-challenge-balance-design.md 2.2):
//   POST /pay/balance   body {"pf": "wechat_wx-2001-android-100-weread"}
// 实测:`pf` 是必填 —— 缺了会返回 499 {"errcode":-2003};带上则 200。
// `balance` 是总余额,`giftBalance` 是赠币部分(实测两者相等)。
import { APP_BASE, appHeaders } from './app-auth.js'
import { CLIENT_PF } from './weekly.js'
// 2026-11-10 实测回包只有:balance / giftBalance / peerBalance / peerGiftBalance /
// isPromoting / paperBalance / incentive —— **没有**任何「即将过期」字段。
// 以前拿 `Number(undefined) || 0` 填 0,于是消息里永远写「即将过期 0.00」,那是假读数。
// 现在:接口给了就报,没给就报「未知」,绝不用 0 冒充。

export const BALANCE_PATH = '/pay/balance'

const DEFAULT_TIMEOUT_MS = 15000
const TEXT_PREVIEW_CHARS = 200

export function buildBalanceBody() {
    return { pf: CLIENT_PF }
}

const EXPIRY_KEYS = ['expiryBalance', 'expiringBalance', 'expireBalance', 'expireAmount']

/** 余额缺失按 0;「即将过期」接口没给就是 null,由渲染层说「未知」。 */
export function parseBalance(payload) {
    const source = payload && typeof payload === 'object' ? payload : {}
    const expiry = EXPIRY_KEYS.map((key) => Number(source[key])).find((value) => Number.isFinite(value))
    return {
        balance: Number(source.balance) || 0,
        giftBalance: Number(source.giftBalance) || 0,
        expiryBalance: Number.isFinite(expiry) ? expiry : null
    }
}

/** 单次 POST,返回形态与 weekly.callWeekly 一致:非 JSON 当空对象,非 200 即失败。 */
async function callBalance(ctx) {
    const context = { fetchImpl: globalThis.fetch, timeoutMs: DEFAULT_TIMEOUT_MS, ...(ctx ?? {}) }
    try {
        const response = await context.fetchImpl(`${APP_BASE}${BALANCE_PATH}`, {
            method: 'POST',
            headers: appHeaders(context.token),
            body: JSON.stringify(buildBalanceBody()),
            signal: AbortSignal.timeout(context.timeoutMs)
        })
        const text = await response.text()
        let parsed = {}
        try {
            parsed = JSON.parse(text)
        } catch { /* 非 JSON 当空对象 */ }
        return { ok: response.status === 200, status: response.status, body: parsed, text: text.slice(0, TEXT_PREVIEW_CHARS) }
    } catch (error) {
        return { ok: false, status: 0, error: error.message }
    }
}

/**
 * 查询书币余额。ctx 可缺省:token 缺失在鉴权头处抛错并被 catch,永不抛错。
 * 成败字段集合一致;失败时余额为 0,reason 说明原因('query-failed')。
 */
export async function readBalance(ctx) {
    const raw = await callBalance(ctx)
    if (!raw.ok) return { ok: false, balance: 0, giftBalance: 0, expiryBalance: null, reason: 'query-failed', raw }
    return { ok: true, ...parseBalance(raw.body), reason: null, raw }
}
