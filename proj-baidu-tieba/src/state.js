// 本地状态与历史:上次运行逻辑日、当天尝试次数与是否已确证完成、最近几条运行结论。
// 只有这两个文件是「程序记忆」;删掉它们等于忘掉所有记录,当天会重跑。
// 原子写 + 坏 JSON 回退空状态不抛(状态坏了不该让签到本身失败)。
import fs from 'node:fs';
import path from 'node:path';

import { readJsonSafe, writeAtomic } from './atomic.js';
import { logicalDay } from './clock.js';

export const STATE_VERSION = 1;
export const HISTORY_KEEP = 200;
export const DAYS_KEEP = 60;

export const stateFile = (dir) => path.join(dir, 'state.json');
export const historyFile = (dir) => path.join(dir, 'history.jsonl');

export function emptyState(now = new Date()) {
  return {
    version: STATE_VERSION,
    updatedAt: now.toISOString(),
    paused: false,
    lastRunDay: null,
    lastResult: null,
    days: {}, // { 'YYYY-MM-DD': { attempts, ok, checkedAt } }
  };
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 逐字段白名单归一:磁盘上的任何垃圾都不该带进内存。 */
function normalize(value) {
  const days = {};
  if (isObject(value.days)) {
    for (const [day, entry] of Object.entries(value.days)) {
      if (!isObject(entry)) continue;
      days[day] = {
        attempts: Number.isFinite(entry.attempts) ? entry.attempts : 0,
        ok: entry.ok === true,
        checkedAt: typeof entry.checkedAt === 'string' ? entry.checkedAt : null,
      };
    }
  }
  return {
    version: STATE_VERSION,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    paused: value.paused === true,
    lastRunDay: typeof value.lastRunDay === 'string' ? value.lastRunDay : null,
    lastResult: value.lastResult === 'success' || value.lastResult === 'failure' ? value.lastResult : null,
    days,
  };
}

/** 读状态:缺失或坏文件都回退空状态,并把原因放进 warnings,绝不抛。 */
export function readState(dir, { fsImpl = fs } = {}) {
  const file = stateFile(dir);
  const { value, error } = readJsonSafe(file, null, { fsImpl });
  if (error) return { state: emptyState(), warnings: [error] };
  if (value === null) return { state: emptyState(), warnings: [] };
  if (!isObject(value)) return { state: emptyState(), warnings: [`${file} 不是对象,已回退空状态`] };
  return { state: normalize(value), warnings: [] };
}

export function writeState(state, dir, now = new Date(), { fsImpl = fs } = {}) {
  // 先序列化副本、写盘成功后才回写内存:写失败时原对象保持原样,不留半更新状态。
  const next = { ...state, updatedAt: now.toISOString() };
  writeAtomic(stateFile(dir), `${JSON.stringify(next, null, 2)}\n`, { fsImpl });
  state.updatedAt = next.updatedAt;
  return state;
}

export const dayRecord = (state, day) => state?.days?.[day] ?? null;
export const attemptsOn = (state, day) => dayRecord(state, day)?.attempts ?? 0;

/**
 * 今天是否已完成 —— Task 9 判断「今天还跑不跑」只许用这个函数。
 * 不许自己拼 lastRunDay + lastResult:lastResult 记的是「最后一次尝试」,
 * 跨日与同日后补失败尝试的边界容易拼错,而 days[day].ok 是当天的权威结论。
 */
export const doneToday = (state, day = logicalDay()) => dayRecord(state, day)?.ok === true;
export const isDayDone = doneToday;

/** days 只留最近 keep 天(按 YYYY-MM-DD 字典序即时间序),防止长期运行无限膨胀。 */
export function pruneDays(state, keep = DAYS_KEEP) {
  const keys = Object.keys(state.days).sort();
  if (keys.length <= keep) return state;
  for (const day of keys.slice(0, keys.length - keep)) delete state.days[day];
  return state;
}

/**
 * 记一次尝试。`ok` 是「对账全部通过」这个权威结论,不是「流程跑完」——
 * ok:false 只加次数、不计完成;已确证完成的一天不会因为之后的失败尝试退回未完成。
 */
export function recordAttempts(state, { day = logicalDay(), ok = false, now = new Date() } = {}) {
  const entry = (state.days[day] ??= { attempts: 0, ok: false, checkedAt: null });
  entry.attempts += 1;
  entry.checkedAt = now.toISOString();
  if (ok === true) entry.ok = true;
  state.lastRunDay = day;
  // 当天的结论单调:entry.ok 只增不减,一旦当天成功,之后的失败尝试不得把
  // lastResult 改回 failure(否则姊妹项目那套 lastRunDay + lastResult 的守卫会重跑)。
  state.lastResult = entry.ok === true ? 'success' : 'failure';
  pruneDays(state);
  return entry;
}

export function setPaused(state, value) {
  state.paused = value === true;
  return state.paused;
}

/**
 * 只把当天结论补成「已完成」,不再加尝试次数。
 * 尝试次数在真正开跑前就已记下(进程被 kill 也要消耗一次),对账通过后用本函数补结论 ——
 * 否则「记一次尝试」会被推到整条网络链路之后,没走到那一步的结束就永远不吃次数。
 */
export function markDayDone(state, { day = logicalDay(), now = new Date() } = {}) {
  const entry = (state.days[day] ??= { attempts: 0, ok: false, checkedAt: null });
  entry.ok = true;
  entry.checkedAt = now.toISOString();
  state.lastRunDay = day;
  state.lastResult = 'success';
  return entry;
}

/** 追加一条历史 JSONL,只留最近 keep 条;整文件重写,不会留下半行。 */
export function appendHistory(entry, dir, { fsImpl = fs, now = new Date(), keep = HISTORY_KEEP } = {}) {
  const file = historyFile(dir);
  const line = JSON.stringify({ at: now.toISOString(), ...entry });
  let lines = [];
  if (fsImpl.existsSync(file)) {
    lines = fsImpl.readFileSync(file, 'utf8').split('\n').filter((row) => row.trim());
  }
  lines.push(line);
  if (lines.length > keep) lines = lines.slice(-keep);
  writeAtomic(file, `${lines.join('\n')}\n`, { fsImpl });
  return JSON.parse(line);
}
