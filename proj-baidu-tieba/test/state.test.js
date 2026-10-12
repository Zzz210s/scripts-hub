// Task 6:状态与历史落盘。全部离线,不碰网络、不用真实时钟。
// 状态是程序唯一的记忆:坏 JSON 必须回退空状态而不是让签到本身失败。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendHistory,
  attemptsOn,
  DAYS_KEEP,
  doneToday,
  emptyState,
  historyFile,
  isDayDone,
  readState,
  recordAttempts,
  setPaused,
  stateFile,
  writeState,
} from '../src/state.js';

/** 每个用例一个临时目录,避免互相污染。 */
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-state-'));

test('writeState/readState:状态往返,写完能在磁盘上读回同样的结构', () => {
  const dir = tmpDir();
  const now = new Date('2026-10-11T09:00:00');
  const state = emptyState(now);
  recordAttempts(state, { day: '2026-10-11', ok: true, now });
  writeState(state, dir, now);

  const { state: back, warnings } = readState(dir);
  assert.deepEqual(warnings, []);
  assert.deepEqual(back, state);
  assert.equal(stateFile(dir), path.join(dir, 'state.json'));
});

test('readState:目录为空给空状态;坏 JSON 与非法形状都回退且带警告', () => {
  const dir = tmpDir();
  const fresh = readState(dir);
  assert.deepEqual(fresh.warnings, []);
  assert.deepEqual({ ...fresh.state, updatedAt: null }, { ...emptyState(new Date(0)), updatedAt: null });

  fs.writeFileSync(stateFile(dir), '{nope', 'utf8');
  const broken = readState(dir);
  assert.deepEqual(broken.state.days, {});
  assert.match(broken.warnings[0], /不是合法 JSON/);

  fs.writeFileSync(stateFile(dir), '[1,2]', 'utf8');
  assert.match(readState(dir).warnings[0], /不是对象/);
});

test('readState:脏字段被归一,不炸', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    stateFile(dir),
    JSON.stringify({ paused: 'yes', lastResult: 'wat', days: { '2026-10-11': { attempts: 'x', ok: 1 } } }),
    'utf8',
  );
  const { state } = readState(dir);
  assert.equal(state.paused, false);
  assert.equal(state.lastResult, null);
  assert.deepEqual(state.days['2026-10-11'], { attempts: 0, ok: false, checkedAt: null });
});

test('recordAttempts:ok:false 不计完成,但次数照加', () => {
  const state = emptyState();
  const now = new Date('2026-10-11T09:00:00');
  recordAttempts(state, { day: '2026-10-11', ok: false, now });
  assert.equal(attemptsOn(state, '2026-10-11'), 1);
  assert.equal(isDayDone(state, '2026-10-11'), false);
  assert.equal(state.lastResult, 'failure');

  recordAttempts(state, { day: '2026-10-11', ok: false, now });
  assert.equal(attemptsOn(state, '2026-10-11'), 2);
  assert.equal(isDayDone(state, '2026-10-11'), false);
});

test('recordAttempts:ok:true 锁当天,之后再来一次失败也不解锁', () => {
  const state = emptyState();
  const now = new Date('2026-10-11T09:00:00');
  recordAttempts(state, { day: '2026-10-11', ok: true, now });
  assert.equal(isDayDone(state, '2026-10-11'), true);
  assert.equal(state.lastRunDay, '2026-10-11');
  assert.equal(state.lastResult, 'success');

  recordAttempts(state, { day: '2026-10-11', ok: false, now });
  assert.equal(isDayDone(state, '2026-10-11'), true);
  assert.equal(attemptsOn(state, '2026-10-11'), 2);
  // 当天结论单调:失败尝试不得把 lastResult 从 success 翻回 failure。
  assert.equal(state.lastResult, 'success');
  assert.equal(doneToday(state, '2026-10-11'), true);
});

test('doneToday:只认当天对账通过,不认「最后一次尝试」', () => {
  const state = emptyState();
  recordAttempts(state, { day: '2026-10-10', ok: true });
  assert.equal(doneToday(state, '2026-10-10'), true);
  assert.equal(doneToday(state, '2026-10-11'), false);
  recordAttempts(state, { day: '2026-10-11', ok: false });
  assert.equal(doneToday(state, '2026-10-11'), false);
  assert.equal(state.lastResult, 'failure');
});

test('recordAttempts:days 只保留最近 60 天', () => {
  const state = emptyState();
  const dayAt = (n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
  for (let i = 0; i < DAYS_KEEP + 5; i++) recordAttempts(state, { day: dayAt(i), ok: false });
  assert.equal(Object.keys(state.days).length, DAYS_KEEP);
  assert.equal(Object.hasOwn(state.days, dayAt(0)), false);
  assert.equal(Object.hasOwn(state.days, dayAt(DAYS_KEEP + 4)), true);
});

test('writeState:写盘失败时内存态不被半更新', () => {
  const dir = tmpDir();
  const state = emptyState(new Date('2026-10-11T09:00:00'));
  const before = state.updatedAt;
  const boomFs = {
    mkdirSync: fs.mkdirSync,
    writeFileSync: () => {
      throw new Error('disk full');
    },
  };
  assert.throws(() => writeState(state, dir, new Date('2026-10-11T10:00:00'), { fsImpl: boomFs }), /disk full/);
  assert.equal(state.updatedAt, before);
  assert.equal(fs.existsSync(stateFile(dir)), false);
});

test('recordAttempts:不同逻辑日互不影响', () => {
  const state = emptyState();
  recordAttempts(state, { day: '2026-10-10', ok: false });
  recordAttempts(state, { day: '2026-10-11', ok: true });
  assert.equal(isDayDone(state, '2026-10-10'), false);
  assert.equal(isDayDone(state, '2026-10-11'), true);
  assert.equal(attemptsOn(state, '2026-10-12'), 0);
});

test('setPaused:只认布尔真值', () => {
  const state = emptyState();
  setPaused(state, true);
  assert.equal(state.paused, true);
  setPaused(state, 0);
  assert.equal(state.paused, false);
});

test('appendHistory:逐行追加,超过 keep 只留最近几条', () => {
  const dir = tmpDir();
  const now = new Date('2026-10-11T09:00:00');
  for (const day of ['2026-10-09', '2026-10-10', '2026-10-11']) {
    appendHistory({ day, ok: day === '2026-10-11' }, dir, { now, keep: 2 });
  }
  const lines = fs.readFileSync(historyFile(dir), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).day),
    ['2026-10-10', '2026-10-11'],
  );
  assert.equal(JSON.parse(lines[1]).at, now.toISOString());
  assert.equal(JSON.parse(lines[1]).ok, true);
});

test('appendHistory:目录不存在也能建出来', () => {
  const dir = path.join(tmpDir(), 'data', 'nested');
  appendHistory({ day: '2026-10-11' }, dir, { now: new Date('2026-10-11T09:00:00') });
  assert.equal(fs.existsSync(historyFile(dir)), true);
});
