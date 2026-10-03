// 会员卡(体验卡 + 付费卡)余额:日报福利行里的「体验卡 N 天」。
//
// 接口来自 2026-10-03 实测(只读,不领取任何东西):
//   GET https://i.weread.qq.com/pay/memberCardSummary?pf=wechat_wx-2001-android-100-weread
// 回包:`remainTime` 是会员卡总剩余秒数(体验卡 + 付费卡),`payingRemainTime` 是其中付费卡的部分,
// 两者之差即体验卡剩余秒数。实测该差值恰为整天(259200 秒 = 3 天),与
// `GET /pay/membercardexitems` 的 `remainFreeDays: 3` 互相印证。
// 注意:同一次 `/weekly/exchange` 的 `infiniteCard.day` 实测报 0,与上面两者不一致,故不采用。
import { APP_BASE, appHeaders } from './app-auth.js'
import { CLIENT_PF } from './weekly.js'

export const MEMBER_CARD_PATH = '/pay/memberCardSummary'

const DEFAULT_TIMEOUT_MS = 15000
const TEXT_PREVIEW_CHARS = 200
const SECONDS_PER_DAY = 86400

export function buildMemberCardQuery() {
    return `?pf=${encodeURIComponent(CLIENT_PF)}`
}

/** 字段缺失 / 非数字 / null / 非对象一律给 0,不抛错。 */
export function parseMemberCard(payload) {
    const source = payload && typeof payload === 'object' ? payload : {}
    const remainSeconds = Math.max(0, Number(source.remainTime) || 0)
    const payingSeconds = Math.max(0, Number(source.payingRemainTime) || 0)
    return {
        remainDays: Math.floor(remainSeconds / SECONDS_PER_DAY),
        freeCardDays: Math.floor(Math.max(0, remainSeconds - payingSeconds) / SECONDS_PER_DAY),
        isPaying: Number(source.isPaying) === 1
    }
}

/** 单次 GET,返回形态与 weekly.callWeekly 一致:非 JSON 当空对象,非 200 即失败。 */
async function callMemberCard(ctx) {
    const context = { fetchImpl: globalThis.fetch, timeoutMs: DEFAULT_TIMEOUT_MS, ...(ctx ?? {}) }
    try {
        const response = await context.fetchImpl(`${APP_BASE}${MEMBER_CARD_PATH}${buildMemberCardQuery()}`, {
            method: 'GET',
            headers: appHeaders(context.token),
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
 * 查询会员卡余额。ctx 可缺省:token 缺失在鉴权头处抛错并被 catch,永不抛错。
 * 成败字段集合一致;失败时天数为 0,reason 说明原因('query-failed')。
 */
export async function readMemberCard(ctx) {
    const raw = await callMemberCard(ctx)
    if (!raw.ok) return { ok: false, freeCardDays: 0, remainDays: 0, isPaying: false, reason: 'query-failed', raw }
    return { ok: true, ...parseMemberCard(raw.body), reason: null, raw }
}
