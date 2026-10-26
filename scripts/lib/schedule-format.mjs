// 调度的纯格式化:时间字符串、ISO8601 时长、人读描述、机器读的触发器期望。
// 从 schedule.mjs 拆出(2026-10-26,守 200 行上限);schedule.mjs 原样 re-export,调用方不用改。
export function parseTime(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''))
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
    return Number(m[1]) * 60 + Number(m[2])
}
export function fmtTime(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
/** 分钟数 -> Windows 任务的 ISO8601 时长:120 -> PT2H,3 -> PT3M。 */
export function isoDuration(minutes) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}` || 'PT0M'
}

// [字段, 最小, 最大] —— 整数校验表
/** 一行话,给人和报告看。 */
export const describe = (p) =>
    `${p.startTime} 起每 ${p.intervalMinutes}m,窗口 ${p.windowHours}h(${p.opportunities} 次机会;最多真跑 ${p.maxAttemptsPerDay} 次)` +
    ` | 登录后 ${p.logonDelayMinutes}m,${p.logonRetryWindowMinutes}m 内每 ${p.logonRetryMinutes}m`

/** 机器可读的期望触发器,deploy-*.sh 拿它与实际任务比对(键与 task_expect 一致)。 */
export const expectation = (p) =>
    [`start=${p.startTime}`, `delay=${isoDuration(p.logonDelayMinutes)}`, `interval=${isoDuration(p.intervalMinutes)}`, `duration=${isoDuration(p.windowMinutes)}`].join('\n')
