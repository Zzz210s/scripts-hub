// T7:时间口径离线单测。只用固定 Date,不读真实时钟。
import test from 'node:test'
import assert from 'node:assert/strict'

import { dateText, DEFAULT_BOUNDARY_HOUR, formatLocal, logicalDay, minutesOfDay } from '../src/clock.js'

test('logicalDay:04:00 前算前一天,04:00 起算当天', () => {
  assert.equal(DEFAULT_BOUNDARY_HOUR, 4)
  assert.equal(logicalDay(new Date('2026-10-11T03:59:00')), '2026-10-10')
  assert.equal(logicalDay(new Date('2026-10-11T04:00:00')), '2026-10-11')
  assert.equal(logicalDay(new Date('2026-10-11T23:59:00')), '2026-10-11')
  // 边界小时可覆盖:0 表示按自然日。
  assert.equal(logicalDay(new Date('2026-10-11T01:00:00'), 0), '2026-10-11')
})

test('dateText/minutesOfDay/formatLocal:本机时区格式', () => {
  const at = new Date('2026-10-11T09:05:00')
  assert.equal(dateText(at), '2026-10-11')
  assert.equal(minutesOfDay(at), 9 * 60 + 5)
  assert.equal(formatLocal(at), '2026-10-11 09:05')
})
