// Task 7:本地守卫与联网守卫。全部离线:时间由 ctx.now 传,不发真实请求也不用真实时钟。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LIMITS,
  checkLocalGuards,
  checkOnlineGuards,
  quietHours,
  shutdownGuard,
} from '../src/guards.js';

/** 除了要测的那一条,其余守卫都放行 —— 顺序靠后的守卫才有机会被命中。 */
const ctx = (now, patch = {}) => ({
  now,
  doneToday: false,
  attempts: 0,
  maxAttempts: 3,
  peerRunning: false,
  freeMb: 4096,
  ...patch,
});

const MORNING = new Date('2026-10-11T09:00:00');

test('quietHours:窗口含起点不含终点,可跨零点', () => {
  assert.equal(quietHours(new Date('2026-10-11T19:59:00')), false);
  assert.equal(quietHours(new Date('2026-10-11T20:00:00')), true);
  assert.equal(quietHours(new Date('2026-10-11T22:59:00')), true);
  assert.equal(quietHours(new Date('2026-10-11T23:00:00')), false);
  assert.equal(quietHours(new Date('2026-10-11T01:00:00'), '23:00', '06:00'), true);
  assert.equal(quietHours(new Date('2026-10-11T12:00:00'), '23:00', '06:00'), false);
  assert.equal(quietHours(new Date('2026-10-11T12:00:00'), 'bogus', '06:00'), false);
});

test('shutdownGuard:距 02:00 关机不足 30 分钟才算命中', () => {
  assert.equal(shutdownGuard(new Date('2026-10-11T01:45:00')), true);
  assert.equal(shutdownGuard(new Date('2026-10-11T01:29:00')), false);
  assert.equal(shutdownGuard(new Date('2026-10-11T02:00:00')), true);
  assert.equal(shutdownGuard(new Date('2026-10-11T09:00:00')), false);
  assert.equal(shutdownGuard(new Date('2026-10-11T01:45:00'), 'bogus', 30), false);
});

test('checkLocalGuards:全部放行时 action=run', () => {
  assert.deepEqual(checkLocalGuards(ctx(MORNING)), { action: 'run', reason: 'ok', detail: '' });
  assert.equal(DEFAULT_LIMITS.minFreeMb, 800);
});

test('checkLocalGuards:六条守卫各命中一次,顺序只报第一个', () => {
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { paused: true })), {
    action: 'skip',
    reason: 'paused',
    detail: '',
  });
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { doneToday: true })), {
    action: 'skip',
    reason: 'done-today',
    detail: '',
  });
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { attempts: 3 })), {
    action: 'skip',
    reason: 'attempts-exhausted',
    detail: '3/3',
  });
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { peerRunning: true, peerDetail: 'rewards 正在运行' })), {
    action: 'skip',
    reason: 'peer-running',
    detail: 'rewards 正在运行',
  });
  assert.deepEqual(checkLocalGuards(ctx(new Date('2026-10-11T21:00:00'))), {
    action: 'skip',
    reason: 'quiet-hours',
    detail: '20:00-23:00',
  });
  assert.deepEqual(checkLocalGuards(ctx(new Date('2026-10-11T01:45:00'))), {
    action: 'skip',
    reason: 'before-shutdown',
    detail: '30 分钟内关机',
  });
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { freeMb: 100 })), {
    action: 'skip',
    reason: 'low-memory',
    detail: '100MB < 800MB',
  });

  // 同时满足多条时,报最先的那条:已完成胜过次数用尽与同伴在跑。
  const both = checkLocalGuards(ctx(MORNING, { doneToday: true, attempts: 9, peerRunning: true }));
  assert.equal(both.reason, 'done-today');
  // 阈值可经 limits 覆盖。
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { freeMb: 100, limits: { minFreeMb: 50 } })), {
    action: 'run',
    reason: 'ok',
    detail: '',
  });
});

test('checkOnlineGuards:没有可用凭据才拦,单账号失效不影响整轮', () => {
  assert.deepEqual(checkOnlineGuards({}), { action: 'skip', reason: 'no-credentials', detail: '未配置账号' });
  assert.equal(checkOnlineGuards({ credentials: [{ name: 'a', ok: true }] }).action, 'run');
  // 缺 ok 字段必须当不可用(fail-closed),不能默认放行。
  assert.deepEqual(checkOnlineGuards({ credentials: [{ name: 'a' }] }), {
    action: 'skip',
    reason: 'credentials-invalid',
    detail: '全部 1 个账号凭据失效',
  });
  assert.deepEqual(checkOnlineGuards({ credentials: [{ name: 'a', ok: true }, { name: 'b', ok: false }] }), {
    action: 'run',
    reason: 'ok',
    detail: '1 个账号凭据失效,其余照跑',
  });
  assert.deepEqual(checkOnlineGuards({ credentials: [{ name: 'a', ok: false }] }), {
    action: 'skip',
    reason: 'credentials-invalid',
    detail: '全部 1 个账号凭据失效',
  });
});
