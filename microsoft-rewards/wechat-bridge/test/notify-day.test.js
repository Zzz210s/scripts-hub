// 汇总通知的测试(node --test 运行)。
//
//   cd %REWARDS_DIR%
//   node --test wechat-bridge\test\notify-day.test.js
//
// 背景:2026-09-25 当天跑了两趟,第二趟的推送里已领完的账号写"本次 +0",
// 用户看到后问"为什么今天有的积分是 0"。这里锁住"合并当天所有运行"的行为。
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildDaySummary } from '../notify-day.js'

const run1 = [
    { at: '2026-09-25T05:13:41.000Z', account: 'a@x.com', gained: 99, before: 10000, balance: 10099, day: '2026-09-25' },
    { at: '2026-09-25T05:13:41.000Z', account: 'b@x.com', gained: 120, before: 700, balance: 820, day: '2026-09-25' },
    { at: '2026-09-25T05:13:41.000Z', account: 'c@x.com', gained: 0, before: 500, balance: 500, day: '2026-09-25' }
]
const run2 = [
    { at: '2026-09-25T06:28:25.000Z', account: 'a@x.com', gained: 0, before: 10099, balance: 10099, day: '2026-09-25' },
    { at: '2026-09-25T06:28:25.000Z', account: 'b@x.com', gained: 210, before: 820, balance: 1030, day: '2026-09-25' },
    { at: '2026-09-25T06:28:25.000Z', account: 'c@x.com', gained: 30, before: 500, balance: 530, day: '2026-09-25' }
]

test('当天多趟运行会合并成逐账号的"今日"合计', () => {
    const text = buildDaySummary('2026-09-25', [...run1, ...run2])
    assert.match(text, /2 次运行合并/)
    assert.match(text, /账号 a@x\.com: 今日 \+99 分/)
    assert.match(text, /账号 b@x\.com: 今日 \+330 分/)
    assert.match(text, /账号 c@x\.com: 今日 \+30 分/)
    assert.match(text, /今日共 \+459 分/)
})

test('重复推送同一份记录不会重复计数', () => {
    const once = buildDaySummary('2026-09-25', [...run1, ...run2])
    const twice = buildDaySummary('2026-09-25', [...run1, ...run2, ...run1, ...run2])
    assert.equal(twice, once)
})

test('单趟运行时不提"合并",也不提"不再有新分"', () => {
    const text = buildDaySummary('2026-09-25', run1)
    assert.doesNotMatch(text, /次运行合并/)
    assert.doesNotMatch(text, /不再有新分/)
})

test('没有记录时给出明确提示', () => {
    const text = buildDaySummary('2026-09-26', [])
    assert.match(text, /没有积分记录/)
})
