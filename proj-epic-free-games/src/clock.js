// 美东时区与换挡点:Epic 免费游戏每周四 11:00 ET 换一批(官方新闻稿统一写 11 AM ET),
// 美国夏令时期间是 15:00Z、冬令时 16:00Z —— 所以**不写死北京时刻**,一律按美东墙钟算。
// 另加年度 Holiday Sale 窗口(12-10 至 01-07,美东日期)供调度提示用。
const ET = 'America/New_York'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const THURSDAY = 4

const partsFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short'
})

/** 美东墙钟:+ 星期(0=周日)。 */
export function etParts(date = new Date()) {
    const out = {}
    for (const { type, value } of partsFormatter.formatToParts(date)) {
        if (type === 'weekday') out.weekday = WEEKDAYS.indexOf(value)
        else if (type === 'year') out.year = Number(value)
        else if (type === 'month') out.month = Number(value)
        else if (type === 'day') out.day = Number(value)
        else if (type === 'hour') out.hour = Number(value) % 24
        else if (type === 'minute') out.minute = Number(value)
        else if (type === 'second') out.second = Number(value)
    }
    return out
}

/** 美东墙钟 - UTC 的分钟数:夏令时 -240,冬令时 -300。 */
export function etOffsetMinutes(dateMs) {
    const p = etParts(new Date(dateMs))
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    return Math.round((asUtc - dateMs) / 60000)
}

/** 把美东墙钟时刻转成 UTC 瞬时;叠两轮修正以躲开夏令时切换附近的不确定。 */
export function etWallToUtc({ year, month, day, hour, minute }) {
    const guess = Date.UTC(year, month - 1, day, hour, minute)
    let instant = guess - etOffsetMinutes(guess) * 60000
    instant = guess - etOffsetMinutes(instant) * 60000
    return new Date(instant)
}

/** 给定时刻前后各展开一周,挑出所有「周四 11:00 美东」边界。 */
function boundaries(now) {
    const p = etParts(now)
    const base = Date.UTC(p.year, p.month - 1, p.day)
    const found = []
    for (let offset = -7; offset <= 8; offset++) {
        const d = new Date(base + offset * 86400000)
        if (d.getUTCDay() !== THURSDAY) continue
        found.push(etWallToUtc({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 11, minute: 0 }))
    }
    found.sort((a, b) => a - b)
    return found
}

/** 当前周期的起止:start = 不晚于 now 的最近边界,end = 下一个边界。 */
export function cycleFor(now = new Date()) {
    const all = boundaries(now)
    const past = all.filter((d) => d.getTime() <= now.getTime())
    const start = past.length ? past[past.length - 1] : null
    const end = all.find((d) => d.getTime() > now.getTime()) ?? null
    return { start, end }
}

export const cycleStart = (now) => cycleFor(now).start
export const cycleEnd = (now) => cycleFor(now).end

/** 年度 Holiday Sale:12-10 起至次年 01-07(含),按美东日期。那段时间每天一个、只挂 24 小时。 */
export function isHolidaySale(now = new Date()) {
    const { month, day } = etParts(now)
    return (month === 12 && day >= 10) || (month === 1 && day <= 7)
}

const pad = (n) => String(n).padStart(2, '0')

/** 本机时区的 `YYYY-MM-DD HH:MM`,用于日志与消息。 */
export function formatLocal(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 本机时区的 `YYYY-MM-DD`,作为状态里的「今天」。 */
export function dayKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
