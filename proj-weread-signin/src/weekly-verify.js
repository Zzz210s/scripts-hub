// 领取自证:领取接口回 200 不代表服务端已生效,也不代表状态立刻可见。
//
// 2026-10-11 真机证据:09:18 那次运行 claimed=[读 7 天:cardx2]、failed=[],
// 紧接着的复查却没看到 status=2 → 日报误报「领取未自证」;4 小时后同一档位 status=2。
// 所以自证分两步:
//   ① 等待 + 复查 awardStatus(最多 3 次,间隔 6-10 秒;查到就提前结束)
//   ② 复查都没证明时,对同一档位再发一次领取做反证 —— -2664「已领过」证明上次已生效,
//      200/errcode 0 说明服务端此刻才接受(两种都算领到)
// 只处理本次刚领取的档位(weekly.claimed),不扩大领取范围;任何异常都不抛穿。
import { claimWeekly, queryWeekly } from './weekly.js'

export const VERIFY_ATTEMPTS = 3
export const VERIFY_DELAY_MIN_MS = 6000
export const VERIFY_DELAY_MAX_MS = 10000
const CLAIMED_STATUS = 2 // 与 weekly.js 的 awardStatus 语义一致

function defaultDelay() {
    const span = VERIFY_DELAY_MAX_MS - VERIFY_DELAY_MIN_MS
    return VERIFY_DELAY_MIN_MS + Math.floor(Math.random() * (span + 1))
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** 只读复查:成功返回 levelId -> status 的 Map;查询失败或抛错返回 null(交给下一次尝试)。 */
async function readStatus(ctx, query) {
    try {
        const after = await query(ctx)
        if (!after?.ok) return null
        return new Map((after.awards ?? []).map(award => [award.levelId, award.status]))
    } catch {
        return null
    }
}

/** 重领反证:幂等(已领过就是 -2664,不会重复发放)。返回 'already' | 'reclaim' | null。 */
async function probeReclaim(ctx, item, reclaim) {
    try {
        const result = await reclaim(ctx, {
            levelId: item.levelId, levelDesc: item.levelDesc, choiceType: item.choiceType, awardNum: item.awardNum
        })
        if (result?.alreadyClaimed) return 'already'
        if (result?.ok && Number(result.errcode) === 0) return 'reclaim'
        return null
    } catch {
        return null
    }
}

function delayFn(delayMs) {
    if (typeof delayMs === 'function') return delayMs
    if (Number.isFinite(delayMs)) return () => delayMs
    return defaultDelay
}

/**
 * 给 weekly.claimed 逐项补 verified / via,其余字段原样返回。
 * via: 'status'(复查到已领取)| 'already'(反证到已领过)| 'reclaim'(反证被接受)| null(没证明)
 * 无档位可领时直接返回,不发任何请求。
 */
export async function verifyWeekly(ctx, weekly, deps = {}) {
    const claimed = weekly?.claimed ?? []
    if (!claimed.length) return weekly
    const query = deps.query ?? queryWeekly
    const reclaim = deps.reclaim ?? claimWeekly
    const sleep = deps.sleep ?? defaultSleep
    const attempts = Math.max(1, Number(deps.attempts) || VERIFY_ATTEMPTS)
    const wait = delayFn(deps.delayMs)

    const proven = new Map()
    let pending = [...claimed]
    for (let round = 0; round < attempts && pending.length; round++) {
        if (round > 0) await sleep(wait(round))
        const status = await readStatus(ctx, query)
        if (!status) continue
        pending = pending.filter(item => {
            if (status.get(item.levelId) !== CLAIMED_STATUS) return true
            proven.set(item.levelId, 'status')
            return false
        })
    }
    for (const item of pending) {
        const via = await probeReclaim(ctx, item, reclaim)
        if (via) proven.set(item.levelId, via)
    }
    return {
        ...weekly,
        claimed: claimed.map(item => {
            const via = proven.get(item.levelId) ?? null
            return { ...item, verified: via !== null, via }
        })
    }
}
