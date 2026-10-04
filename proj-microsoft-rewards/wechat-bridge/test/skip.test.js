// skip 与 action 两类消息的文案测试(node --test 运行)。
//
//   cd %REWARDS_DIR%
//   node --test wechat-bridge\test\skip.test.js
//
// 2026-10-03 用户反馈:两类消息原本几乎一样。现在 skip 标题写「正常跳过」,
// action 标题写「需要你处理」,正文结构也不同。
// 2026-10-04 用户反馈:正常跳过(今天已经跑过)不必再推企业微信,只写运行日志。
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSkipMessage, isSilentSkip } from '../lib/skip.js'

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

// 2026-10-04:正常跳过(今天已经跑过)只写运行日志不推送;有风险的跳过照旧推送。
test('静音表:只有「今天已经跑过」不推送,有风险的跳过照旧推', () => {
    assert.equal(isSilentSkip('handled'), true)
    for (const mode of ['memory', 'exhausted', 'nocreds']) assert.equal(isSilentSkip(mode), false)
})

test('尝试次数用尽:照旧推送,文案不说「今天已经跑过」', () => {
    const withGain = buildSkipMessage({ mode: 'exhausted', arg: '2026-10-04', gained: 62 })
    const lines = withGain.split('\n')
    assert.match(lines[0], /^微软积分 · \d{4}-\d{2}-\d{2} · 正常跳过$/)
    assert.equal(lines[1], '')
    assert.equal(lines[2], '原因:今天已经用满尝试次数 · 当天的额度不再重试')
    assert.match(withGain, /已入账:今日 \+62 分/)
    assert.match(withGain, /后续:明天的第一次触发自动重来/)
    assert.match(withGain, /你需要做什么:不需要/)
    assert.doesNotMatch(withGain, /今天已经跑过/)
    assert.doesNotMatch(withGain, /[()]/)

    // 没拿到分数时不编数字
    const noGain = buildSkipMessage({ mode: 'exhausted', arg: '2026-10-04', gained: 0 })
    assert.doesNotMatch(noGain, /已入账:/)
})
