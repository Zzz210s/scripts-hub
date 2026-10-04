// 运行流程两类通知的接线:开始提醒只一句话(不再联网预览);
// 跳过提醒里正常跳过只记日志,有风险的才受"每天一条"额度限制。
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { sendSkipNotice, sendStartNotice } from '../src/run-notice.js'

// 平台无关:Windows 与 Linux 上都能跑,快照不需要按盘符做任何替换
const CWD = path.join(os.tmpdir(), 'weread-notice')
const CONFIG = { curlFile: 'secrets/read-request.curl', webhookFile: 'secrets/webhook.txt' }
const PLAN = { todayMinutes: 135, targetMinutes: 5, minutesSoFar: 300, remainingDays: 29, failableDays: 1, sections: [{ minutes: 3 }, { minutes: 2 }] }

test('sendStartNotice:一句话说明开始跑,发到 webhook', async () => {
    const sent = []
    const res = await sendStartNotice({
        cwd: CWD, config: CONFIG, plan: PLAN, date: '2026-10-02', accountName: 'TestReader',
        send: async (text, opts) => { sent.push({ text, opts }); return { ok: true } }
    })
    assert.equal(res.ok, true)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].text, '微信读书签到 · TestReader · 2026-10-02 · 开始自动阅读')
    assert.match(sent[0].opts.webhookFile, /secrets[\\/]webhook\.txt$/)
})

test('sendStartNotice:不再联网预览挑战与余额,取数抛错也照样发', async () => {
    const sent = []
    await sendStartNotice({
        cwd: CWD, config: CONFIG, plan: PLAN, date: '2026-10-02', accountName: 'TestReader',
        deps: { ensureAppToken: async () => { throw new Error('不该被调用') } },
        send: async text => { sent.push(text); return { ok: true } }
    })
    assert.equal(sent[0], '微信读书签到 · TestReader · 2026-10-02 · 开始自动阅读')
    assert.doesNotMatch(sent[0], /挑战:|福利:/)
})

test('sendSkipNotice:当天已发过就不再发;dry-run 每次都发', async () => {
    const seen = []
    const res = await sendSkipNotice({
        cwd: CWD, config: CONFIG, plan: null, date: '2026-10-02', reason: 'before-shutdown', dryRun: false,
        notifyOnce: (dir, key, date) => { seen.push([key, date]); return false }
    })
    assert.deepEqual(res, { ok: true, skipped: true })
    assert.deepEqual(seen, [['before-shutdown', '2026-10-02']])

    const dry = await sendSkipNotice({
        cwd: CWD, config: CONFIG, plan: null, date: '2026-10-02', reason: 'before-shutdown', dryRun: true,
        notifyOnce: () => { throw new Error('dry-run 不该消耗额度') }
    })
    assert.equal(dry.ok, true)
    assert.equal(dry.note, 'dry-run 未发送')
})

// 2026-10-04 用户反馈:正常跳过(已达标 / 同伴在跑 / 安静时段)不必再推企业微信。
test('sendSkipNotice:正常跳过只记运行日志,不推送也不消耗额度', async () => {
    for (const reason of ['done', 'peer-running', 'quiet-hours']) {
        let sent = 0
        const logged = []
        const res = await sendSkipNotice({
            cwd: CWD, config: CONFIG, plan: null, date: '2026-10-02', reason, detail: '测试详情', dryRun: false,
            notifyOnce: () => { throw new Error('正常跳过不该消耗提醒额度') },
            send: async () => { sent += 1; return { ok: true } },
            log: line => { logged.push(line) }
        })
        assert.deepEqual(res, { ok: true, skipped: true, silent: true })
        assert.equal(sent, 0, `${reason} 不该发消息`)
        assert.equal(logged.length, 1)
        assert.match(logged[0], new RegExp(`只记日志.*${reason}`))
    }
})

test('sendSkipNotice:有风险的跳过照旧推送', async () => {
    for (const reason of ['low-memory', 'attempts-exhausted', 'before-shutdown', 'paused']) {
        const sent = []
        const res = await sendSkipNotice({
            cwd: CWD, config: CONFIG, plan: null, date: '2026-10-02', reason, dryRun: false,
            notifyOnce: () => true,
            send: async text => { sent.push(text); return { ok: true } },
            log: () => {}
        })
        assert.equal(res.ok, true)
        assert.equal(sent.length, 1, `${reason} 应该发消息`)
        assert.match(sent[0], /原因:/)
    }
})

test('sendSkipNotice:当天首次时发一条不带圆括号的说明', async () => {
    const sent = []
    const res = await sendSkipNotice({
        cwd: CWD, config: CONFIG, plan: null, date: '2026-10-02', accountName: 'TestReader',
        reason: 'low-memory', detail: '812MB', dryRun: false, notifyOnce: () => true,
        send: async text => { sent.push(text); return { ok: true } }
    })
    assert.equal(res.ok, true)
    assert.match(sent[0], /原因:可用内存不足 · 812MB/)
    assert.doesNotMatch(sent[0], /[()]/)
})
