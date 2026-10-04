// 通知排版约定的守卫:scripts-hub/docs/notification-convention.md。
//
// 开始消息一行(名称 · 账号 · 日期 · 动作);结果消息 标题行 / 空行 / 正文;
// skip 与 action 标题与正文分开写;分隔符统一 · ,禁止圆括号。改动文案时这里会先挡住跑偏。
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildReport } from '../src/notify.js'
import { buildSkipMessage, buildStartMessage } from '../src/notify-policy.js'

const BASE = {
    plan: { todayMinutes: 20, targetMinutes: 66, minutesSoFar: 300, remainingDays: 25, failableDays: 3, validDaysSoFar: 5, sections: [{ minutes: 30 }] },
    config: { requiredMinutes: 1800, requiredValidDays: 29, quietStart: '20:00', quietEnd: '23:00' },
    date: '2026-10-03',
    accountName: 'TestReader'
}

const start = buildStartMessage(BASE)
const skip = buildSkipMessage({ ...BASE, reason: 'done' })
const action = buildSkipMessage({ ...BASE, reason: 'credential-invalid', detail: 'HTTP 401' })
const report = buildReport({ ...BASE, run: { ok: true, reportedSeconds: 1800, requests: 3, outcome: '成功' } })
const failed = buildReport({ ...BASE, run: { ok: false, reportedSeconds: 0, requests: 3, outcome: '失败 · 退出码 1' } })

test('开始消息只有一行:名称 · 账号 · 日期 · 动作', () => {
    assert.equal(start, '微信读书签到 · TestReader · 2026-10-03 · 开始自动阅读')
    assert.equal(start.split('\n').length, 1)
})

test('结果消息是 标题行 + 空行 + 正文', () => {
    for (const text of [report, failed]) {
        const lines = text.split('\n')
        assert.match(lines[0], /^微信读书签到 · TestReader · 2026-10-03 · \S+$/)
        assert.equal(lines[1], '')
        assert.match(lines[2], /^阅读:/)
    }
})

test('skip 与 action 标题行不同,正文结构也不同', () => {
    assert.match(skip.split('\n')[0], /· 正常跳过$/)
    assert.match(action.split('\n')[0], /· 需要你处理$/)
    for (const text of [skip, action]) assert.equal(text.split('\n')[1], '')
    // skip 先说原因,再说后续与「不需要你做什么」
    assert.match(skip.split('\n')[2], /^原因:/)
    assert.match(skip, /后续:/)
    assert.match(skip, /你需要做什么:不需要/)
    assert.doesNotMatch(skip, /请你:/)
    // action 第一句就是请你做什么,再给原因与不处理的后果
    assert.match(action.split('\n')[2], /^请你:/)
    assert.match(action, /原因:/)
    assert.match(action, /不处理的后果:/)
    assert.doesNotMatch(action, /你需要做什么:不需要/)
})

test('只有凭据失效与读不到统计算需要人工处理,其余原因是正常跳过', () => {
    const skipReasons = ['peer-running', 'done', 'quiet-hours', 'before-shutdown', 'attempts-exhausted', 'paused', 'low-memory']
    for (const reason of skipReasons) {
        assert.match(buildSkipMessage({ ...BASE, reason }).split('\n')[0], /· 正常跳过$/)
    }
    // 读不到官方统计改成需要人工处理:多半是 cookie 或接口有问题,不处理就一直不跑
    const stats = buildSkipMessage({ ...BASE, reason: 'stats-unavailable', detail: '统计接口 HTTP 500' })
    assert.match(stats.split('\n')[0], /· 需要你处理$/)
    assert.match(stats.split('\n')[2], /^请你:/)
    assert.match(stats, /原因:读不到官方阅读统计 · 统计接口 HTTP 500/)
    assert.match(stats, /不处理的后果:/)
    assert.doesNotMatch(stats, /正常跳过|你需要做什么:不需要/)
})

test('动作词共用同一个词表', () => {
    assert.match(start, /· 开始自动阅读$/)
    assert.match(report.split('\n')[0], /· 运行成功$/)
    assert.match(failed.split('\n')[0], /· 运行有失败$/)
})

test('本次行只报续期,上报分钟、请求次数与结果都不进消息', () => {
    const text = buildReport({
        ...BASE,
        run: { ok: true, reportedSeconds: 3840, requests: 91, outcome: '成功', renewal: '凭据已自动续期', alert: '', note: '凭据已自动续期 · wr_skey · 官方计入约 57 分钟' }
    })
    assert.match(text, /^本次:凭据已自动续期$/m)
    assert.doesNotMatch(text, /上报|次请求|wr_skey|官方计入/)
})

test('没有续期也没有异常时,整条本次行不出现', () => {
    const text = buildReport({ ...BASE, run: { ok: true, reportedSeconds: 2400, requests: 5, outcome: '成功', renewal: '', alert: '' } })
    assert.doesNotMatch(text, /本次:/)
})

test('计入异常与读回失败没有续期时仍进本次行', () => {
    const text = buildReport({ ...BASE, run: { ok: true, outcome: '成功', renewal: '', alert: '读回失败,本次是否计入未能确认:boom' } })
    assert.match(text, /^本次:读回失败,本次是否计入未能确认:boom$/m)
})

test('所有文案都没有圆括号,也没有 emoji', () => {
    for (const text of [start, skip, action, report, failed]) {
        assert.doesNotMatch(text, /[()]/)
        assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    }
})
