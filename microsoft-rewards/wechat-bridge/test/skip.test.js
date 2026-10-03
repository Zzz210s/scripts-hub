// skip 与 action 两类消息的文案测试(node --test 运行)。
//
//   cd E:\Microsoft-Rewards-Script-4.3.2
//   node --test wechat-bridge\test\skip.test.js
//
// 2026-10-03 用户反馈:两类消息原本几乎一样。现在 skip 标题写「正常跳过」,
// action 标题写「需要你处理」,正文结构也不同。
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSkipMessage } from '../lib/skip.js'

test('内存不足:正常跳过,正文说清原因 / 后续 / 不需要你做什么', () => {
    const text = buildSkipMessage({ mode: 'memory', arg: '812' })
    const lines = text.split('\n')
    assert.match(lines[0], /^微软积分 · \d{4}-\d{2}-\d{2} · 正常跳过$/)
    assert.equal(lines[1], '')
    assert.equal(lines[2], '原因:可用内存不足 · 可用 812MB 低于启动门槛')
    assert.match(text, /后续:/)
    assert.match(text, /你需要做什么:不需要/)
    assert.doesNotMatch(text, /请你:|不处理的后果:/)
    assert.doesNotMatch(text, /[()]/)
})

test('当天已跑过:带已入账分数,没有分数时不编数字', () => {
    const withGain = buildSkipMessage({ mode: 'handled', arg: '2026-10-03', gained: 407 })
    assert.match(withGain, /原因:今天已经跑过 · 一天只运行一遍/)
    assert.match(withGain, /已入账:今日 \+407 分 · 重复运行不会再有新分/)
    assert.match(withGain, /你需要做什么:不需要/)

    const noGain = buildSkipMessage({ mode: 'handled', arg: '2026-10-03', gained: 0 })
    assert.match(noGain, /已入账:当天的积分已经领取过/)
    assert.doesNotMatch(noGain, /今日 \+0 分/)

    const otherDay = buildSkipMessage({ mode: 'handled', arg: '2026-10-02', sameDay: false, gained: 12 })
    assert.match(otherDay, /原因:2026-10-02 已经跑过/)
})

test('没有配置账号:需要你处理,正文第一句就是请你做什么', () => {
    const lines = buildSkipMessage({ mode: 'nocreds' }).split('\n')
    assert.match(lines[0], /^微软积分 · \d{4}-\d{2}-\d{2} · 需要你处理$/)
    assert.equal(lines[1], '')
    assert.match(lines[2], /^请你:把账号邮箱与密码写进 \.env/)
    assert.match(lines[3], /^原因:/)
    assert.match(lines[4], /^不处理的后果:/)
    assert.doesNotMatch(lines.join('\n'), /[()]/)
})

test('两类消息的标题与正文不重样', () => {
    const skip = buildSkipMessage({ mode: 'memory', arg: '812' })
    const action = buildSkipMessage({ mode: 'nocreds' })
    assert.notEqual(skip.split('\n')[0], action.split('\n')[0])
    assert.doesNotMatch(skip, /需要你处理|请你:/)
    assert.doesNotMatch(action, /正常跳过|你需要做什么:不需要/)
})
