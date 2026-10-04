// 挑战详情(微信读书「阅读挑战」):查询进度、挑选进行中的挑战、派生「还能漏几天」。
//
// 接口来自 2026-10-02 实测(见 docs/superpowers/specs/2026-10-02-challenge-balance-design.md 2.1):
//   GET /challenge/detail?version=v3&scene=2
// 回包 challengeList[]:readTime 是秒;readDateList 是有效阅读日时间戳(长度即已读天数);
// challenge.targetTime(秒)/ targetDay(天)是完成条件,challengeDay 是总天数;
// price > 0 表示付费挑战。奖赏四件套:reachRewardCoin / reachRewardCard(达标奖书币 / 体验卡天),
// extraRewardCoin / extraRewardCard(超额奖书币 / 体验卡天)。
// 本模块只读,不发报名/开始请求。
import { APP_BASE, appHeaders } from './app-auth.js'

export const CHALLENGE_PATH = '/challenge/detail?version=v3&scene=2'

const DEFAULT_TIMEOUT_MS = 15000
const TEXT_PREVIEW_CHARS = 200
const SECONDS_PER_DAY = 86400

/** 归一化单条挑战:字段缺失一律给安全默认值,不抛错。status 供 pickChallenges 过滤。 */
function normalizeChallenge(item) {
    const challenge = item?.challenge && typeof item.challenge === 'object' ? item.challenge : {}
    const startTime = Number(item?.startTime) || 0
    const endTime = Number(item?.endTime) || 0
    const currentTime = Number(item?.currentTime) || Date.now()
    const readDateList = Array.isArray(item?.readDateList) ? item.readDateList : []
    return {
        id: typeof item?.id === 'string' ? item.id : '',
        status: Number(item?.status) || 0,
        isPaid: Number(challenge.price) > 0,
        totalDays: Number(challenge.challengeDay) || 0,
        targetDays: Number(challenge.targetDay) || 0,
        targetSeconds: Number(challenge.targetTime) || 0,
        readSeconds: Number(item?.readTime) || 0,
        readDays: readDateList.length,
        remainDays: Math.max(0, Math.floor((endTime - currentTime) / SECONDS_PER_DAY)),
        rewardCoin: Number(challenge.reachRewardCoin) || 0,
        rewardCard: Number(challenge.reachRewardCard) || 0,
        extraRewardCoin: Number(challenge.extraRewardCoin) || 0,
        extraRewardCard: Number(challenge.extraRewardCard) || 0,
        startTime,
        endTime
    }
}

/** payload.challengeList → 归一化条目数组;null / 非对象 / 列表缺失都返回 []。 */
export function parseChallenges(payload) {
    const source = payload && typeof payload === 'object' ? payload : {}
    const list = Array.isArray(source.challengeList) ? source.challengeList : []
    return list.map(normalizeChallenge)
}

function isPaidEntry(entry) {
    if (entry?.isPaid === true) return true
    return Number(entry?.challenge?.price) > 0
}

/** 只留进行中(status === 1),付费挑战在前;组内保持输入顺序。 */
export function pickChallenges(list) {
    const active = (Array.isArray(list) ? list : []).filter(entry => Number(entry?.status) === 1)
    return [...active.filter(isPaidEntry), ...active.filter(entry => !isPaidEntry(entry))]
}

/** 派生值:canMiss 负数取 0;done 需天数与时长双达标。 */
export function summarize(entry) {
    const readDays = Number(entry?.readDays) || 0
    const targetDays = Number(entry?.targetDays) || 0
    const readSeconds = Number(entry?.readSeconds) || 0
    const targetSeconds = Number(entry?.targetSeconds) || 0
    const remainDays = Number(entry?.remainDays) || 0
    return {
        remainDays,
        canMiss: Math.max(0, remainDays - Math.max(0, targetDays - readDays)),
        done: readDays >= targetDays && readSeconds >= targetSeconds
    }
}

/** 单次 GET,返回形态与 weekly.callWeekly 一致。ctx 缺省:token 缺失在鉴权头处抛错并被 catch。 */
async function callChallenge(ctx) {
    const context = { fetchImpl: globalThis.fetch, timeoutMs: DEFAULT_TIMEOUT_MS, ...(ctx ?? {}) }
    try {
        const response = await context.fetchImpl(`${APP_BASE}${CHALLENGE_PATH}`, {
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

/** 查询并解析。失败也返回对象:list 恒为数组,reason 成功时为 null;永不抛错。 */
export async function queryChallenges(ctx) {
    const raw = await callChallenge(ctx)
    if (!raw.ok) return { ok: false, list: [], reason: 'query-failed', raw }
    return { ok: true, list: parseChallenges(raw.body), reason: null, raw }
}

/** 查询 → 挑选 → 派生。永不抛错,失败只体现在返回值里,调用方决定是否记历史。 */
export async function collectChallenge(ctx) {
    const query = await queryChallenges(ctx)
    if (!query.ok) return { ok: false, list: [], reason: 'query-failed', raw: query.raw }
    const list = pickChallenges(query.list).map(entry => ({ ...entry, ...summarize(entry) }))
    return { ok: true, list, reason: null, raw: query.raw }
}
