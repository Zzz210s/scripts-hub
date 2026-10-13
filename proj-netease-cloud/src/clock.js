// T7:时间口径:逻辑日以 boundaryHour(默认 04:00)为界 —— 04:00 之前算前一天。
// 该边界与套件其它程序一致(proj-baidu-tieba/src/clock.js、proj-bilibili-tasks/src/clock.js)。
// 只有这里碰 Date;调用方把 now 传进来,便于单测与时间桩。
const pad = (n) => String(n).padStart(2, '0')

export const DEFAULT_BOUNDARY_HOUR = 4

/** 自然日 YYYY-MM-DD(本机时区,不做边界偏移)。 */
export const dateText = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** 逻辑日 YYYY-MM-DD:边界小时之前算前一天。 */
export function logicalDay(date = new Date(), boundaryHour = DEFAULT_BOUNDARY_HOUR) {
  return dateText(new Date(date.getTime() - boundaryHour * 3600000))
}

/** 当天的分钟数,供守卫的安静时段与关机避让用。 */
export const minutesOfDay = (date = new Date()) => date.getHours() * 60 + date.getMinutes()

/** 本机时区的 YYYY-MM-DD HH:MM,用于日志。 */
export const formatLocal = (date = new Date()) =>
  `${dateText(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
