// 「按官方口径现算一次今日目标」:每次都重新取挑战进度,再交给 planDay。
//
// 为什么要单出一个文件:run.js 的会话循环与开头都要用它,而它横跨鉴权(读挑战)、
// 计划与窗口推导三件事;塞回 run.js 会把编排主干挤过 200 行上限。
//
// 为什么每次都要重新读:统计接口与挑战接口不是同一本账。2026-10-30 那次,循环里用统计口径
// 重算,算出「已经达标」,当天只排了 5 分钟 —— 而挑战还差 11 分钟,30 天挑战因此失败。
import { activeChallenge } from './challenge.js'
import { planDay, windowFromChallenge } from './plan.js'
import { readChallengeOnly } from './rewards-run.js'

/**
 * @param {object} input
 * @param {string} input.cwd
 * @param {object} input.config
 * @param {Date} input.now
 * @param {object} input.deps 注入面:测试可给假的 readChallengeOnly
 * @param {() => object|null} input.getStats 取当前统计(可为 null)
 * @param {() => number} input.getAttempts 取当天已尝试次数
 */
export function makeLivePlanner({ cwd, config, now, deps, getStats, getAttempts }) {
    return async function replan(todaySeconds) {
        const readChallenge = deps.readChallengeOnly ?? readChallengeOnly
        let live = null
        try {
            live = activeChallenge(await readChallenge({ cwd, config, deps }))
        } catch {
            // 读不到挑战就回落统计口径 —— planDay 会如实标出 progressSource: 'stats'
            live = null
        }
        const window = windowFromChallenge(live)
        const base = window
            ? { ...config, challengeStart: window.start, challengeEndsOn: window.end, windowAssumed: false }
            : config
        const stats = getStats()
        return planDay({
            now,
            config: base,
            buckets: stats?.buckets ?? [],
            todaySeconds,
            attempts: getAttempts(),
            challenge: live
        })
    }
}
