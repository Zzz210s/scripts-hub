// 状态:每个账号每个逻辑日领到多少、页面当时是什么样。幂等靠它 —— 当天已领过就不再点。
// 形状:{ "days": { "2026-11-26": { "a1": { clicks, before, after, delta, at, note } } } },只保留最近 30 天。
import path from 'node:path'
import { readJsonSafe, writeAtomic } from './clock.js'

const KEEP_DAYS = 30

export const stateFile = (dir) => path.join(dir, 'state.json')

export function loadState(dir) {
  const { value, error } = readJsonSafe(stateFile(dir), { days: {} })
  const days = value && typeof value.days === 'object' && value.days ? value.days : {}
  return { state: { days }, error }
}

export function saveState(dir, state) {
  const days = Object.entries(state.days ?? {})
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, KEEP_DAYS)
  writeAtomic(stateFile(dir), `${JSON.stringify({ days: Object.fromEntries(days) }, null, 1)}\n`)
}

export function dayRecord(state, day) {
  state.days[day] = state.days[day] ?? {}
  return state.days[day]
}

export const accountRecord = (state, day, id) => state.days?.[day]?.[id] ?? null

/** 当天是否已经有过一次成功的领取(有 delta>0 或 clicks>0 且没被风控)。 */
export function claimedToday(state, day, id) {
  const record = accountRecord(state, day, id)
  if (!record) return false
  return record.done === true
}

export function recordRun(state, { day, id, clicks, before, after, delta, note }) {
  const day_ = dayRecord(state, day)
  const previous = day_[id] ?? {}
  day_[id] = {
    clicks: (previous.clicks ?? 0) + (clicks ?? 0),
    before: before ?? previous.before ?? null,
    after: after ?? previous.after ?? null,
    delta: (previous.delta ?? 0) + (delta ?? 0),
    // 「今天没任务」不算完成:任务可能过几小时才出现,那时还要能再跑一次。
    // 只有真的点到并让豆数变了(或此前已经领过)才记为完成。
    done: Boolean(previous.done || (clicks > 0 && delta > 0)),
    at: new Date().toISOString(),
    note: note ?? null,
  }
  return day_[id]
}
