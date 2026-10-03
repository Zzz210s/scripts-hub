// 时钟与「今天还能跑多久」:纯函数、零依赖。守卫与每日目标共用,避免两者互相 import 成环。

export function parseClock(text) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim())
    if (!match) return null
    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (hours > 23 || minutes > 59) return null
    return hours * 60 + minutes
}

function minutesOfDay(date) {
    return date.getHours() * 60 + date.getMinutes()
}

/** 安静时段(支持跨午夜,如 22:00-07:00)。 */
export function inQuietHours(now, quietStart, quietEnd) {
    const start = parseClock(quietStart)
    const end = parseClock(quietEnd)
    if (start === null || end === null || start === end) return false
    const current = minutesOfDay(now)
    return start < end ? current >= start && current < end : current >= start || current < end
}

/** 距离关机还有多久(分钟);已过关机时刻时返回负值。 */
export function minutesToShutdown(now, shutdownTime) {
    const shutdown = parseClock(shutdownTime)
    if (shutdown === null) return Number.POSITIVE_INFINITY
    const diff = shutdown - minutesOfDay(now)
    return diff >= 0 ? diff : diff + 24 * 60
}

/** 距下一次安静时段开始还有多久(分钟);正处在安静时段时返回 0。 */
function minutesUntilQuiet(now, quietStart, quietEnd) {
    const start = parseClock(quietStart)
    if (start === null) return Number.POSITIVE_INFINITY
    if (inQuietHours(now, quietStart, quietEnd)) return 0
    const current = minutesOfDay(now)
    return current < start ? start - current : 24 * 60 - current + start
}

/**
 * 今天从此刻起还能用于自动阅读的分钟数,取三个约束的最小值:
 *   剩余可跑次数 × 单次会话上限(还能跑几次)、到安静时段开始(不打扰真实阅读)、到关机避让线。
 * 配置缺失时对应约束不生效;正处在安静时段返回 0。
 */
export function availableWindow(now, config = {}, attempts = 0) {
    if (inQuietHours(now, config.quietStart, config.quietEnd)) return 0
    const runs = Math.max(1, (config.maxAttemptsPerDay ?? 3) - Math.max(0, attempts))
    const runnable = runs * (config.runTimeoutMinutes ?? 100)
    const toShutdown = minutesToShutdown(now, config.shutdownTime) - (config.shutdownGuardMinutes ?? 30)
    const toQuiet = minutesUntilQuiet(now, config.quietStart, config.quietEnd)
    return Math.max(0, Math.floor(Math.min(runnable, toQuiet, toShutdown)))
}
