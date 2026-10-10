// 本地段守卫(纯函数,不联网)。顺序固定,只报第一个命中的原因:
// paused -> done-today -> attempts-exhausted -> peer-running -> quiet-hours -> before-shutdown -> low-memory。
// no-credentials 由 run.js 在守卫之前判(它不是「本地段该不该跑」,而是「还没准备」)。
import { dayKey, minutesOfDay } from './clock.js'

export const DEFAULT_LIMITS = {
    quietStart: '20:00',
    quietEnd: '23:00',
    shutdownTime: '02:00',
    shutdownMarginMinutes: 30,
    minFreeMb: 800
}

const parseClock = (clock) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(clock ?? ''))
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** 落在安静时段内(窗口可跨零点)。 */
export function quietHours(now, start = DEFAULT_LIMITS.quietStart, end = DEFAULT_LIMITS.quietEnd) {
    const from = parseClock(start)
    const to = parseClock(end)
    if (from === null || to === null) return false
    const minute = minutesOfDay(now)
    return from <= to ? minute >= from && minute < to : minute >= from || minute < to
}

/** 距关机时刻不足 margin 分钟(跨零点)。 */
export function shutdownGuard(now, shutdown = DEFAULT_LIMITS.shutdownTime, marginMinutes = DEFAULT_LIMITS.shutdownMarginMinutes) {
    const at = parseClock(shutdown)
    if (at === null) return false
    return (at - minutesOfDay(now) + 1440) % 1440 < marginMinutes
}

export const memorySkip = (freeMb, minFreeMb = DEFAULT_LIMITS.minFreeMb) =>
    freeMb < minFreeMb ? { skip: true, reason: 'low-memory', detail: `${freeMb}MB` } : { skip: false }

export function shouldSkipLocally({
    now = new Date(),
    paused = false,
    lastRunDay = null,
    lastResult = null,
    attempts = 0,
    maxAttempts = 2,
    peerRunning = false,
    freeMb = Infinity,
    boundaryHour = 4,
    limits = {}
} = {}) {
    const cfg = { ...DEFAULT_LIMITS, ...limits }
    if (paused) return { skip: true, reason: 'paused', detail: '' }
    if (lastRunDay === dayKey(now, boundaryHour) && lastResult === 'success') return { skip: true, reason: 'done-today', detail: lastRunDay }
    if (attempts >= maxAttempts) return { skip: true, reason: 'attempts-exhausted', detail: `${attempts}/${maxAttempts}` }
    if (peerRunning) return { skip: true, reason: 'peer-running', detail: '' }
    if (quietHours(now, cfg.quietStart, cfg.quietEnd)) return { skip: true, reason: 'quiet-hours', detail: `${cfg.quietStart}-${cfg.quietEnd}` }
    if (shutdownGuard(now, cfg.shutdownTime, cfg.shutdownMarginMinutes)) return { skip: true, reason: 'before-shutdown', detail: cfg.shutdownTime }
    const memory = memorySkip(freeMb, cfg.minFreeMb)
    if (memory.skip) return memory
    return { skip: false }
}
