// T7:本地状态与历史:上次运行逻辑日、当天尝试次数、是否已确证完成、当天熔断标记与云贝基线。
// 只有这两个文件是「程序记忆」;删掉它们等于忘掉所有记录,当天会重跑。
// 原子写 + 坏 JSON 回退空状态不抛(状态坏了不该让签到本身失败)。
//
// 与贴吧状态的差异:多一个「当天熔断」标记(circuitBroken + circuitKind)。鉴权失效或限流时写下,
// 由守卫的 circuit-broken 阻止同一天再次请求;跨天自然失效,不需要人工清除。熔断不是完成:
// 当天仍可被 attempts-exhausted 之外的原因重新考虑,但设计矩阵要求「当天不再请求」。
import fs from 'node:fs'
import path from 'node:path'

import { readJsonSafe, writeAtomic } from './atomic.js'
import { logicalDay } from './clock.js'

export const STATE_VERSION = 1
export const HISTORY_KEEP = 200
export const DAYS_KEEP = 60

export const stateFile = (dir) => path.join(dir, 'state.json')
export const historyFile = (dir) => path.join(dir, 'history.jsonl')

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const newDayEntry = () => ({
  attempts: 0,
  ok: false,
  checkedAt: null,
  circuitBroken: false,
  circuitKind: null,
})

export function emptyState(now = new Date()) {
  return {
    version: STATE_VERSION,
    updatedAt: now.toISOString(),
    paused: false,
    lastRunDay: null,
    lastResult: null,
    baseline: null, // day0 采一次云贝/成长值基线,之后只读不改(见 verify.day0Baseline)
    days: {}, // { 'YYYY-MM-DD': { attempts, ok, checkedAt, circuitBroken, circuitKind } }
  }
}

/** 逐字段白名单归一:磁盘上的任何垃圾都不该带进内存。 */
function normalizeDay(entry) {
  if (!isObject(entry)) return newDayEntry()
  return {
    attempts: Number.isFinite(entry.attempts) ? entry.attempts : 0,
    ok: entry.ok === true,
    checkedAt: typeof entry.checkedAt === 'string' ? entry.checkedAt : null,
    circuitBroken: entry.circuitBroken === true,
    circuitKind: typeof entry.circuitKind === 'string' ? entry.circuitKind : null,
  }
}

function normalize(value) {
  const days = {}
  if (isObject(value.days)) {
    for (const [day, entry] of Object.entries(value.days)) days[day] = normalizeDay(entry)
  }
  return {
    version: STATE_VERSION,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    paused: value.paused === true,
    lastRunDay: typeof value.lastRunDay === 'string' ? value.lastRunDay : null,
    lastResult: value.lastResult === 'success' || value.lastResult === 'failure' ? value.lastResult : null,
    baseline: isObject(value.baseline) ? { ...value.baseline } : null,
    days,
  }
}

/** 读状态:缺失或坏文件都回退空状态,并把原因放进 warnings,绝不抛。 */
export function readState(dir, { fsImpl = fs } = {}) {
  const file = stateFile(dir)
  const { value, error } = readJsonSafe(file, null, { fsImpl })
  if (error) return { state: emptyState(), warnings: [error] }
  if (value === null) return { state: emptyState(), warnings: [] }
  if (!isObject(value)) return { state: emptyState(), warnings: [`${file} 不是对象,已回退空状态`] }
  return { state: normalize(value), warnings: [] }
}

export function writeState(state, dir, now = new Date(), { fsImpl = fs } = {}) {
  // 先序列化副本、写盘成功后才回写内存:写失败时原对象保持原样,不留半更新状态。
  const next = { ...state, updatedAt: now.toISOString() }
  writeAtomic(stateFile(dir), `${JSON.stringify(next, null, 2)}\n`, { fsImpl })
  state.updatedAt = next.updatedAt
  return state
}

export const dayRecord = (state, day) => state?.days?.[day] ?? null
export const attemptsOn = (state, day) => dayRecord(state, day)?.attempts ?? 0

/**
 * 今天是否已完成 —— 编排判断「今天还跑不跑」只许用这个函数。
 * 不许自己拼 lastRunDay + lastResult:lastResult 记的是「最后一次尝试」,跨日边界容易拼错,
 * 而 days[day].ok 是当天的权威结论。
 */
export const doneToday = (state, day = logicalDay()) => dayRecord(state, day)?.ok === true
export const isDayDone = doneToday

/** 当天是否已熔断(鉴权/限流)。跨天自动失效。 */
export const isCircuitBroken = (state, day = logicalDay()) => dayRecord(state, day)?.circuitBroken === true

const entryFor = (state, day) => (state.days[day] ??= newDayEntry())

/** days 只留最近 keep 天(按 YYYY-MM-DD 字典序即时间序),防止长期运行无限膨胀。 */
export function pruneDays(state, keep = DAYS_KEEP) {
  const keys = Object.keys(state.days).sort()
  if (keys.length <= keep) return state
  for (const day of keys.slice(0, keys.length - keep)) delete state.days[day]
  return state
}

/**
 * 记一次尝试。`ok` 是「业务读回确认已签」这个权威结论,不是「流程跑完」——
 * ok:false 只加次数、不计完成;已确证完成的一天不会因为之后的失败尝试退回未完成。
 */
export function recordAttempts(state, { day = logicalDay(), ok = false, now = new Date() } = {}) {
  const entry = entryFor(state, day)
  entry.attempts += 1
  entry.checkedAt = now.toISOString()
  if (ok === true) entry.ok = true
  state.lastRunDay = day
  // 当天的结论单调:entry.ok 只增不减,一旦当天成功,之后的失败尝试不得把 lastResult 改回 failure。
  state.lastResult = entry.ok === true ? 'success' : 'failure'
  pruneDays(state)
  return entry
}

/**
 * 只把当天结论补成「已完成」,不再加尝试次数。
 * 尝试次数在真正开跑前就已记下(进程被 kill 也要消耗一次),读回确认后用本函数补结论。
 */
export function markDayDone(state, { day = logicalDay(), now = new Date() } = {}) {
  const entry = entryFor(state, day)
  entry.ok = true
  entry.checkedAt = now.toISOString()
  state.lastRunDay = day
  state.lastResult = 'success'
  return entry
}

/** 当天熔断:鉴权失效 / 限流时写下。kind 非字符串一律归一为 auth,不把垃圾带进状态。 */
export function breakCircuit(state, { day = logicalDay(), kind = 'auth', now = new Date() } = {}) {
  const entry = entryFor(state, day)
  entry.circuitBroken = true
  entry.circuitKind = typeof kind === 'string' && kind ? kind : 'auth'
  entry.checkedAt = now.toISOString()
  return entry
}

export function setPaused(state, value) {
  state.paused = value === true
  return state.paused
}

/** 追加一条历史 JSONL,只留最近 keep 条;整文件重写,不会留下半行。 */
export function appendHistory(entry, dir, { fsImpl = fs, now = new Date(), keep = HISTORY_KEEP } = {}) {
  const file = historyFile(dir)
  const line = JSON.stringify({ at: now.toISOString(), ...entry })
  let lines = []
  if (fsImpl.existsSync(file)) {
    lines = fsImpl.readFileSync(file, 'utf8').split('\n').filter((row) => row.trim())
  }
  lines.push(line)
  if (lines.length > keep) lines = lines.slice(-keep)
  writeAtomic(file, `${lines.join('\n')}\n`, { fsImpl })
  return JSON.parse(line)
}
