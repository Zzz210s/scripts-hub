// 运行前的守卫:安静时段、关机避让、今天是否已完成。纯函数,便于离线测试。
// 时钟计算与「今天还能跑多久」在 clock.js,这里重新导出,保持既有调用方不变。
import { inQuietHours, minutesToShutdown, parseClock } from './clock.js'
import { localDay } from './plan.js'

export { inQuietHours, minutesToShutdown, parseClock }

/**
 * 本地守卫(不联网、很快):暂停 / 今日已达标 / 尝试次数 / 同伴在跑 / 安静时段 / 关机避让。
 * 这些条件不满足时根本不需要访问网络 —— 先跑它们能省下凭据体检与统计读取的耗时。
 * @returns {{run:boolean, reason:string, detail?:string}}
 */
export function decideLocal(input) {
    const { now, config, state, paused, force, peerBusy, peerDetail } = input
    if (paused) return { run: false, reason: 'paused', detail: '已手动暂停(data/paused 存在)' }
    // 顺序讲究:先说“今天已经完成”这种最需要知道的结论,再说错峰/时段这类过程原因
    if (state?.done) return { run: false, reason: 'done', detail: `今天已达标(${state.todayMinutes} 分钟)` }
    if (state?.attempts >= (config.maxAttemptsPerDay ?? 3)) {
        return { run: false, reason: 'attempts-exhausted', detail: `今天已尝试 ${state.attempts} 次` }
    }
    if (peerBusy) return { run: false, reason: 'peer-running', detail: peerDetail ?? '另一个自动化程序正在运行 · 错峰设置' }
    if (!force && inQuietHours(now, config.quietStart, config.quietEnd)) {
        return { run: false, reason: 'quiet-hours', detail: `${config.quietStart}-${config.quietEnd} 不打扰真实阅读` }
    }
    const toShutdown = minutesToShutdown(now, config.shutdownTime)
    if (toShutdown <= config.shutdownGuardMinutes) {
        return { run: false, reason: 'before-shutdown', detail: `距 ${config.shutdownTime} 关机仅 ${toShutdown} 分钟` }
    }
    return { run: true, reason: 'ok', detail: `${localDay(now)} 可以跑` }
}

/** 联网后的守卫:凭据是否有效、官方统计能不能读到、今天是否已经读够。 */
export function decideRemote(input) {
    const { credential, credentialDetail, stats, plan } = input
    if (credential === false) {
        return { run: false, reason: 'credential-invalid', detail: credentialDetail ?? 'cookie 已失效,需要重新扫码登录' }
    }
    if (!stats?.ok) return { run: false, reason: 'stats-unavailable', detail: stats?.error ?? '官方统计读不到' }
    // 统计里今天已经读到目标(例如你自己在手机上读够了):不再多跑一轮
    if (plan && plan.runMinutes <= 0) {
        return { run: false, reason: 'done', detail: `今天已达标(${plan.todayMinutes} 分钟)` }
    }
    return { run: true, reason: 'ok', detail: '凭据与统计均正常' }
}
