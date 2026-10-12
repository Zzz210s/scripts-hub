// Task 6:逻辑日与时间口径。全部离线,不碰网络。
// 04:00 边界是从姊妹项目踩坑得来的约定,这条回归同时锁住边界值本身。

import test from 'node:test';
import assert from 'node:assert/strict';

import { dateText, logicalDay, minutesOfDay } from '../src/clock.js';

test('logicalDay:04:00 前算前一天,04:00 起算当天', () => {
  assert.equal(logicalDay(new Date('2026-10-11T03:59:00')), '2026-10-10');
  assert.equal(logicalDay(new Date('2026-10-11T04:00:00')), '2026-10-11');
  assert.equal(logicalDay(new Date('2026-10-11T23:59:00')), '2026-10-11');
  assert.equal(logicalDay(new Date('2026-10-12T00:30:00')), '2026-10-11');
});

test('logicalDay:边界小时可覆盖,dateText/minutesOfDay 是自然日口径', () => {
  assert.equal(logicalDay(new Date('2026-10-11T03:00:00'), 0), '2026-10-11');
  assert.equal(logicalDay(new Date('2026-10-11T03:00:00'), 6), '2026-10-10');
  assert.equal(dateText(new Date('2026-10-11T03:00:00')), '2026-10-11');
  assert.equal(minutesOfDay(new Date('2026-10-11T21:30:00')), 21 * 60 + 30);
});
