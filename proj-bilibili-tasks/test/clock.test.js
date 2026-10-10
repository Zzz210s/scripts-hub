import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayKey, dateText, minutesOfDay, DEFAULT_BOUNDARY_HOUR } from '../src/clock.js'

test('dayKey 在 04:00 边界两侧分属两个逻辑日', () => {
    assert.equal(dayKey(new Date('2026-10-11T03:59:00')), '2026-10-10')
    assert.equal(dayKey(new Date('2026-10-11T04:00:00')), '2026-10-11')
})

test('边界小时可覆盖', () => {
    assert.equal(dayKey(new Date('2026-10-11T05:00:00'), 6), '2026-10-10')
    assert.equal(dayKey(new Date('2026-10-11T06:00:00'), 6), '2026-10-11')
})

test('dateText 不做边界偏移', () => {
    assert.equal(dateText(new Date('2026-10-11T03:00:00')), '2026-10-11')
})

test('跨月与跨年', () => {
    assert.equal(dayKey(new Date('2026-11-01T02:00:00')), '2026-10-31')
    assert.equal(dayKey(new Date('2027-01-01T02:00:00')), '2026-12-31')
})

test('minutesOfDay 与默认边界', () => {
    assert.equal(minutesOfDay(new Date('2026-10-11T20:30:00')), 20 * 60 + 30)
    assert.equal(DEFAULT_BOUNDARY_HOUR, 4)
})
