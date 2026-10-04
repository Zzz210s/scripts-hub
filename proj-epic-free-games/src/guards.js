// 本地段守卫(纯函数,不联网):安静时段、关机避让、内存闸门、同伴互查、尝试次数。
// 与 docs/scheduling-convention.md 第 2 节同一套判定,差别只是这里的阈值是可传参数。
export const DEFAULT_LIMITS = {
    quietStart: '20:00',
    quietEnd: '23:00',
    shutdownTime: '02:00',
    shutdownMarginMinutes: 30,
    minFreeMb: 800
}

const minutesOfDay = (now) => now.getHours() * 60 + now.getMinutes()
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
    const diff = (at - minutesOfDay(now) + 1440) % 1440
    return diff < marginMinutes
}

/** 可用内存闸门。 */
export const memorySkip = (freeMb, minFreeMb = DEFAULT_LIMITS.minFreeMb) =>
    freeMb < minFreeMb ? { skip: true, reason: 'low-memory', detail: `${freeMb}MB` } : { skip: false }

/**
 * 这次触发该不该在本地段就退出。顺序固定,只报第一个命中的原因:
 * 已暂停 -> 尝试次数用尽 -> 同伴在跑 -> 安静时段 -> 临近关机 -> 内存不足。
 */
export function shouldSkipLocally({
    now = new Date(),
    paused = false,
    attempts = 0,
    maxAttempts = 2,
    peerRunning = false,
    freeMb = Infinity,
    limits = {}
} = {}) {
    const cfg = { ...DEFAULT_LIMITS, ...limits }
    if (paused) return { skip: true, reason: 'paused', detail: '' }
    if (attempts >= maxAttempts) return { skip: true, reason: 'already-attempted', detail: `${attempts}/${maxAttempts}` }
    if (peerRunning) return { skip: true, reason: 'peer-running', detail: '' }
    if (quietHours(now, cfg.quietStart, cfg.quietEnd)) return { skip: true, reason: 'quiet-hours', detail: `${cfg.quietStart}-${cfg.quietEnd}` }
    if (shutdownGuard(now, cfg.shutdownTime, cfg.shutdownMarginMinutes)) return { skip: true, reason: 'shutdown-soon', detail: cfg.shutdownTime }
    const memory = memorySkip(freeMb, cfg.minFreeMb)
    if (memory.skip) return memory
    return { skip: false }
}
