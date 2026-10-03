import assert from 'node:assert/strict'
import test from 'node:test'

import { parseStats, todaySeconds, summarize } from '../src/stats.js'

// 与 2026-10-01 真实响应的形状一致(数值为构造值,不含任何个人信息)
// 时间戳按本机时区从日期算出,避免测试依赖运行机器所在的时区
const day = iso => Math.floor(new Date(`${iso}T00:00:00`).getTime() / 1000)
const payload = {
    baseTime: 1759248000,
    totalReadTime: 1131,
    readDays: 1,
    dayAverageReadTime: 282,
    compare: -0.4,
    readTimes: {
        [day('2026-09-28')]: 0,
        [day('2026-09-29')]: 0,
        [day('2026-09-30')]: 1101,
        [day('2026-10-01')]: 30
    }
}
const now = new Date('2026-10-01T12:00:00')

test('parseStats 保留秒为单位的数值,不做单位猜测', () => {
    const stats = parseStats(payload)
    assert.equal(stats.totalSeconds, 1131)
    assert.equal(stats.readDays, 1)
    assert.equal(stats.dayAverageSeconds, 282)
    assert.equal(stats.compare, -0.4)
    assert.equal(stats.buckets.length, 4)
})

test('todaySeconds 取今天那一桶的秒数', () => {
    assert.equal(todaySeconds(payload, now), 30)
})

test('todaySeconds 在今天还没有桶时返回 0', () => {
    assert.equal(todaySeconds(payload, new Date('2026-10-02T09:00:00')), 0)
})

test('summarize 输出人类可读文案(秒四舍五入到分钟)', () => {
    const text = summarize({ totalSeconds: 1131, readDays: 1, todaySeconds: 20 })
    assert.match(text, /今日 0 分钟/)
    assert.match(text, /本周期 19 分钟/)
    assert.match(text, /有效天数 1 天/)
    assert.match(summarize({ totalSeconds: 1131, readDays: 1, todaySeconds: 30 }), /今日 1 分钟/)
})

test('缺少字段时不抛错(接口字段按 mode 可选返回)', () => {
    const stats = parseStats({})
    assert.equal(stats.totalSeconds, 0)
    assert.equal(stats.readDays, 0)
    assert.deepEqual(stats.buckets, [])
})
