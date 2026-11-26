// 时间口径与原子写。逻辑日以 boundaryHour(默认 04:00)为界 —— 04:00 之前算前一天,
// 与套件里贴吧/B站的 clock.js 保持一致;只有这里碰 Date,调用方把 now 传进来便于测试。
import fs from 'node:fs'
import path from 'node:path'

const pad = (n) => String(n).padStart(2, '0')

export const DEFAULT_BOUNDARY_HOUR = 4

export const dateText = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const logicalDay = (date = new Date(), boundaryHour = DEFAULT_BOUNDARY_HOUR) =>
  dateText(new Date(date.getTime() - boundaryHour * 3600000))

export const minutesOfDay = (date = new Date()) => date.getHours() * 60 + date.getMinutes()

export const formatLocal = (date = new Date()) =>
  `${dateText(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`

/** "HH:MM" → 分钟数;格式不对返回 null。 */
export const parseHm = (text) => {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim())
  if (!matched) return null
  const hour = Number(matched[1])
  const minute = Number(matched[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/** 安静时段判断,支持跨零点(23:30 → 06:30)。 */
export function inQuietHours(minutes, start, end) {
  const from = parseHm(start)
  const to = parseHm(end)
  if (from === null || to === null || from === to) return false
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** 原子写:先写同目录临时文件再 rename;目标被占用时短暂自旋重试(Windows 上实测会抛 EBUSY)。 */
export function writeAtomic(file, text, { retries = 5 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, text, 'utf8')
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (error) {
      if (!RETRYABLE.has(error?.code) || attempt >= retries) {
        try { fs.rmSync(tmp, { force: true }) } catch { /* 清理失败无所谓 */ }
        throw error
      }
      const until = Date.now() + 20
      while (Date.now() < until) { /* spin */ }
    }
  }
}

/** 读 JSON;缺失返回 fallback 且 error 为空,坏了返回 fallback 并给出 error 消息。 */
export function readJsonSafe(file, fallback) {
  if (!fs.existsSync(file)) return { value: fallback, error: null }
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')), error: null }
  } catch (error) {
    return { value: fallback, error: `${file} 不是合法 JSON:${error.message}` }
  }
}
