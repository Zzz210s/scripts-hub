// 开始运行消息的测试(node --test 运行)。
//
//   cd E:\Microsoft-Rewards-Script-4.3.2
//   node --test wechat-bridge\test\start.test.js
//
// 与微信读书签到共用同一套排版:一行说明哪个程序开始跑;分隔符统一 · ;禁止圆括号。
// 第几次尝试 / 并行度 / 触发方式 / 上次结果不再进消息,只进运行日志(2026-10-03 用户要求)。
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildStartMessage } from '../lib/start.js'

test('开始消息只有一行,账号槽位写数量', () => {
    const text = buildStartMessage({ day: '2026-10-03', accounts: 5 })
    assert.equal(text, '微软积分 · 5 个账号 · 2026-10-03 · 开始运行')
    assert.equal(text.split('\n').length, 1)
    assert.doesNotMatch(text, /[()]/)
})

test('一个账号都没有时不说"0 个账号"', () => {
    assert.equal(buildStartMessage({ day: '2026-10-03', accounts: 0 }), '微软积分 · 2026-10-03 · 开始运行')
})

test('自动重试时只在行尾补一句极短提示', () => {
    assert.equal(
        buildStartMessage({ day: '2026-10-03', accounts: 5, retry: true }),
        '微软积分 · 5 个账号 · 2026-10-03 · 开始运行 · 重试'
    )
})

test('多传的尝试次数 / 并行度 / 上次结果不再进消息', () => {
    const text = buildStartMessage({
        day: '2026-10-03', accounts: 5, attempt: 2, clusters: 2,
        note: '开机自动运行', lastRun: { day: '2026-10-02', status: 'ok', gained: 412 }
    })
    assert.equal(text, '微软积分 · 5 个账号 · 2026-10-03 · 开始运行')
    assert.doesNotMatch(text, /今天:|计划:|并行:|上次:|触发:/)
})
