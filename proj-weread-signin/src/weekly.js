// 阅读时长福利(每周阅读奖励):查询档位与领取。
//
// 接口来自 2026-10-02 手机抓包(该路径在 APK 里是动态拼接的,反编译与枚举都命中不了):
//   POST /weekly/exchange
//     awardLevelId=0, awardChoiceType=0, isExchangeAward=0  → 查询
//     awardLevelId=N, awardChoiceType=1|2, isExchangeAward=1 → 领取(1 体验卡 / 2 书币)
// 实测:查询 200;对已领取档位发起领取返回 499 {"errcode":-2664} —— -2664 的语义是「该档位已领过」,
// 不是真失败,所以单独归到 alreadyClaimed。
import { APP_BASE, appHeaders } from './app-auth.js'

export const WEEKLY_PATH = '/weekly/exchange'
export const CLIENT_PF = 'wechat_wx-2001-android-100-weread'

const DEFAULT_TIMEOUT_MS = 15000
const TEXT_PREVIEW_CHARS = 200
const CLAIMED_STATUS = 2           // 已领取
const UNREACHED_STATUS = 0         // 未达成(差多少见 statusDesc)
const ALREADY_CLAIMED_CODE = -2664 // 服务端语义:该档位已领过

export function buildStatusBody() {
    return { awardLevelId: 0, awardChoiceType: 0, isExchangeAward: 0, isVisitReadGoal: 1, unread: 1, pf: CLIENT_PF }
}

export function buildClaimBody(claim) {
    const { levelId, choiceType } = claim ?? {}
    return { awardLevelId: levelId, awardChoiceType: choiceType, isExchangeAward: 1, isVisitReadGoal: 1, unread: 1, pf: CLIENT_PF }
}

function normalizeChoices(raw) {
    if (!Array.isArray(raw)) return []
    return raw.map(item => ({
        choiceType: Number(item?.choiceType) || 0,
        awardNum: Number(item?.awardNum) || 0,
        canChoice: Number(item?.canChoice) || 0
    }))
}

function normalizeAward(raw) {
    return {
        levelId: Number(raw?.awardLevelId) || 0,
        levelDesc: typeof raw?.awardLevelDesc === 'string' ? raw.awardLevelDesc : '',
        choicesDesc: typeof raw?.awardChoicesDesc === 'string' ? raw.awardChoicesDesc : '',
        status: Number(raw?.awardStatus) || 0,
        statusDesc: typeof raw?.awardStatusDesc === 'string' ? raw.awardStatusDesc : '',
        choices: normalizeChoices(raw?.awardChoices)
    }
}

export function parseWeekly(payload) {
    const source = payload && typeof payload === 'object' ? payload : {}
    const groups = [source.readtimeAwards, source.readdayAwards, source.readgoalAwards]
    const awards = groups.filter(Array.isArray).flat().map(normalizeAward)
    return {
        readingSeconds: Number(source.readingTime) || 0,
        readingDays: Number(source.readingDay) || 0,
        awards
    }
}

/**
 * 挑出该领取的档位。偏好:书币(choiceType 2)优先,不可选时退回体验卡(choiceType 1)。
 * 「已领取」与「未达成」跳过;其它(未知)状态也入列 —— 服务端会拒绝不满足条件的请求,
 * 失败以 `failed` 返回,是否记录由调用方决定。空项、缺 choices 一律跳过。
 */
export function pickClaim(awards) {
    const picked = []
    for (const award of awards ?? []) {
        if (award?.status === CLAIMED_STATUS || award?.status === UNREACHED_STATUS) continue
        const choices = award?.choices ?? []
        const coin = choices.find(c => c.choiceType === 2 && c.canChoice === 1)
        const card = choices.find(c => c.choiceType === 1 && c.canChoice === 1)
        const chosen = coin ?? card
        if (!chosen) continue
        picked.push({ levelId: award.levelId, levelDesc: award.levelDesc, choiceType: chosen.choiceType, awardNum: chosen.awardNum })
    }
    return picked
}

/** ctx 可缺省:归一化后 token 缺失只会在鉴权头处失败,并被 catch 成失败对象,永不抛错。 */
export async function callWeekly(ctx, body) {
    const context = { fetchImpl: globalThis.fetch, timeoutMs: DEFAULT_TIMEOUT_MS, ...ctx }
    try {
        const response = await context.fetchImpl(`${APP_BASE}${WEEKLY_PATH}`, {
            method: 'POST',
            headers: appHeaders(context.token),
            body: JSON.stringify(body),
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

export async function queryWeekly(ctx) {
    const raw = await callWeekly(ctx, buildStatusBody())
    const base = { readingSeconds: 0, readingDays: 0, awards: [], raw, reason: null }
    if (!raw.ok) return { ...base, ok: false, reason: 'query-failed' }
    return { ...base, ok: true, ...parseWeekly(raw.body) }
}

export async function claimWeekly(ctx, claim) {
    const raw = await callWeekly(ctx, buildClaimBody(claim))
    // 没拿到响应时 errcode 记 null —— 0 在业务语义里是「成功」,不能拿它占位。
    const received = raw.body !== undefined
    const errcode = received ? (Number(raw.body?.errcode) || 0) : null
    return {
        ok: raw.ok && errcode === 0,
        status: raw.status,
        errcode,
        alreadyClaimed: errcode === ALREADY_CLAIMED_CODE,
        raw
    }
}

/**
 * 查询 → 逐档领取。永不抛错:失败只体现在返回值里,调用方决定要不要通知。
 * 每个分支字段集合一致;`failed` 只收真失败,`-2664`(已领过)归 `alreadyClaimed`。
 */
/** 档位统计:日报要看「本周几档、已领几、还差几」。 */
function summarizeTiers(awards) {
    const tiers = { total: awards.length, claimed: 0, unreached: 0, claimable: 0 }
    for (const award of awards) {
        if (award.status === CLAIMED_STATUS) tiers.claimed++
        else if (award.status === UNREACHED_STATUS) tiers.unreached++
        else tiers.claimable++
    }
    return tiers
}

export async function collectWeekly(ctx) {
    const query = await queryWeekly(ctx)
    const base = { readingSeconds: 0, readingDays: 0, tiers: { total: 0, claimed: 0, unreached: 0, claimable: 0 }, claimable: 0, claimed: [], alreadyClaimed: [], failed: [], raw: null, reason: null }
    if (!query.ok) return { ...base, ok: false, reason: 'query-failed', raw: query.raw }
    const picks = pickClaim(query.awards)
    const claimed = []
    const alreadyClaimed = []
    const failed = []
    for (const pick of picks) {
        const result = await claimWeekly(ctx, pick)
        if (result.ok) claimed.push(pick)
        else if (result.alreadyClaimed) alreadyClaimed.push(pick)
        else failed.push({ ...pick, errcode: result.errcode, status: result.status })
    }
    return {
        ...base,
        tiers: summarizeTiers(query.awards),
        ok: true,
        readingSeconds: query.readingSeconds,
        readingDays: query.readingDays,
        claimable: picks.length,
        claimed,
        alreadyClaimed,
        failed,
        raw: query.raw
    }
}
