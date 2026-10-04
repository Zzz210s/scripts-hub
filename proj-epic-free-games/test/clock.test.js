// 美东时区与换挡点:断言用一手事实,不用被测代码自己算的期望值。
// 事实来源:Epic 官方新闻稿把促销边界写成 11 AM ET;2026-10-05 实测接口
// curStart=2026-10-01T15:00:00Z / curEnd=2026-10-08T15:00:00Z(11:00 EDT)。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etParts, etOffsetMinutes, etWallToUtc, cycleFor, cycleStart, cycleEnd, isHolidaySale, formatLocal } from '../src/clock.js'

const at = (iso) => new Date(iso)

test('etParts 给出美东墙钟与星期', () => {
    // 2026-10-01 是周四;15:00Z 在夏令时里是 11:00 EDT
    const p = etParts(at('2026-10-01T15:00:00Z'))
    assert.deepEqual({ y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute, wd: p.weekday }, { y: 2026, m: 10, d: 1, h: 11, min: 0, wd: 4 })
    // 冬令时:2026-11-05T16:00Z 是 11:00 EST
    assert.equal(etParts(at('2026-11-05T16:00:00Z')).hour, 11)
})

test('etOffsetMinutes 在夏令时 / 冬令时分别给 -240 / -300', () => {
    assert.equal(etOffsetMinutes(at('2026-10-01T15:00:00Z').getTime()), -240)
    assert.equal(etOffsetMinutes(at('2026-11-05T15:00:00Z').getTime()), -300)
})

test('etWallToUtc 在两侧夏令时边界上给对 UTC 时刻', () => {
    assert.equal(etWallToUtc({ year: 2026, month: 10, day: 1, hour: 11, minute: 0 }).toISOString(), '2026-10-01T15:00:00.000Z')
    assert.equal(etWallToUtc({ year: 2026, month: 11, day: 5, hour: 11, minute: 0 }).toISOString(), '2026-11-05T16:00:00.000Z')
    assert.equal(etWallToUtc({ year: 2026, month: 3, day: 12, hour: 11, minute: 0 }).toISOString(), '2026-03-12T15:00:00.000Z')
})

test('周期边界:周四 11:00 美东,夏令时 15:00Z', () => {
    const c = cycleFor(at('2026-10-05T12:00:00Z'))
    assert.equal(c.start.toISOString(), '2026-10-01T15:00:00.000Z')
    assert.equal(c.end.toISOString(), '2026-10-08T15:00:00.000Z')
})

test('周期边界在换挡前一秒仍属上一周期', () => {
    assert.equal(cycleEnd(at('2026-10-01T14:59:59Z')).toISOString(), '2026-10-01T15:00:00.000Z')
    assert.equal(cycleStart(at('2026-10-01T14:59:59Z')).toISOString(), '2026-09-24T15:00:00.000Z')
})

test('夏令时结束后边界变 16:00Z,且跨越切换的那一周不是整 168 小时', () => {
    // 2026 年美国夏令时 11-01 结束:10-29 这周是 EDT,11-05 这周是 EST
    const c = cycleFor(at('2026-11-02T12:00:00Z'))
    assert.equal(c.start.toISOString(), '2026-10-29T15:00:00.000Z')
    assert.equal(c.end.toISOString(), '2026-11-05T16:00:00.000Z')
    assert.equal((c.end - c.start) / 3600000, 169)
})

test('夏令时开始后边界回到 15:00Z', () => {
    const c = cycleFor(at('2026-03-09T12:00:00Z'))
    assert.equal(c.start.toISOString(), '2026-03-05T16:00:00.000Z')
    assert.equal(c.end.toISOString(), '2026-03-12T15:00:00.000Z')
})

test('cycleStart / cycleEnd 与 cycleFor 一致', () => {
    const now = at('2026-12-20T05:00:00Z')
    assert.equal(cycleStart(now).getTime(), cycleFor(now).start.getTime())
    assert.equal(cycleEnd(now).getTime(), cycleFor(now).end.getTime())
    assert.equal(etParts(cycleEnd(now)).hour, 11)
    assert.equal(etParts(cycleEnd(now)).weekday, 4)
})

test('Holiday Sale 窗口按美东日期判定 12-10 至 01-07', () => {
    assert.equal(isHolidaySale(at('2026-10-06T12:00:00Z')), false)
    assert.equal(isHolidaySale(at('2026-12-15T12:00:00Z')), true)
    assert.equal(isHolidaySale(at('2027-01-03T12:00:00Z')), true)
    assert.equal(isHolidaySale(at('2027-01-08T12:00:00Z')), false)
})

test('isHolidaySale 按美东日期,不按 UTC 日期(01-08 01:00Z 还是 01-07 美东)', () => {
    assert.equal(isHolidaySale(at('2027-01-08T01:00:00Z')), true)
})

test('formatLocal 输出 HH:MM 本地可读时刻', () => {
    assert.match(formatLocal(at('2026-10-08T15:00:00Z')), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})
