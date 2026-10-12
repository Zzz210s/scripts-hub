// 本地状态与历史:上次运行逻辑日、当天尝试次数与是否已确证完成、最近几条运行结论。
// 只有这两个文件是「程序记忆」;删掉它们等于忘掉所有记录,当天会重跑。
// 原子写 + 坏 JSON 回退空状态不抛(状态坏了不该让签到本身失败)。
import fs from 'node:fs';
import path from 'node:path';

import { readJsonSafe, writeAtomic } from './atomic.js';
import { logicalDay } from './clock.js';

export const STATE_VERSION = 1;
export const HISTORY_KEEP = 200;

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
  state.updatedAt = now.toISOString();
  writeAtomic(stateFile(dir), `${JSON.stringify(state, null, 2)}\n`, { fsImpl });
  return state;
}

export const dayRecord = (state, day) => state?.days?.[day] ?? null;
export const attemptsOn = (state, day) => dayRecord(state, day)?.attempts ?? 0;
export const isDayDone = (state, day) => dayRecord(state, day)?.ok === true;

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
  state.lastResult = entry.ok ? 'success' : 'failure';
  return entry;
}

export function setPaused(state, value) {
  state.paused = value === true;
  return state.paused;
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
