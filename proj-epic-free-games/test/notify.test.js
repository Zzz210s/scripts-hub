// 发送层:字节截断、超时/重试/errcode 处理、脱敏。全部用注入的 fetch 桩,不联网。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendWecom, truncateText, maskSecret } from '../src/notify.js'

const bytes = (s) => Buffer.byteLength(s, 'utf8')
const reply = (body, { ok = true, status = 200 } = {}) => async () => ({ ok, status, text: async () => JSON.stringify(body) })

test('截断按 UTF-8 字节,不切半个汉字,结果不超上限', () => {
    const long = '游'.repeat(2000)
    const out = truncateText(long, 2048)
    assert.ok(bytes(out) <= 2048)
    assert.ok(out.endsWith('...'))
    assert.doesNotMatch(out, /\uFFFD/)
    // 未超限时原样返回
    assert.equal(truncateText('短', 2048), '短')
})

test('errcode=0 直接成功,只发一次', async () => {
    let calls = 0
    const res = await sendWecom('hi', { webhook: 'https://example.com/hook', fetchImpl: async (...a) => { calls++; return (await reply({ errcode: 0, errmsg: 'ok' })(...a)) } })
    assert.deepEqual(res, { ok: true })
    assert.equal(calls, 1)
})

test('限流 45009 指数退避重试后成功', async () => {
    const sleeps = []
    let calls = 0
    const res = await sendWecom('hi', {
        webhook: 'https://example.com/hook',
        sleep: async (ms) => { sleeps.push(ms) },
        fetchImpl: async () => {
            calls++
            return calls < 3 ? await reply({ errcode: 45009, errmsg: 'limit' })() : await reply({ errcode: 0 })()
        }
    })
    assert.deepEqual(res, { ok: true })
    assert.equal(calls, 3)
    assert.deepEqual(sleeps, [1000, 2000])
})

test('其它 errcode 不重试,错误里带 errcode', async () => {
    let calls = 0
    const res = await sendWecom('hi', {
        webhook: 'https://example.com/hook',
        sleep: async () => {},
        fetchImpl: async () => { calls++; return await reply({ errcode: 93000, errmsg: 'invalid webhook' })() }
    })
    assert.equal(calls, 1)
    assert.equal(res.ok, false)
    assert.equal(res.errcode, 93000)
    assert.match(res.error, /93000/)
})

test('HTTP 非 2xx 与网络失败按可重试处理', async () => {
    let calls = 0
    const res = await sendWecom('hi', {
        webhook: 'https://example.com/hook',
        sleep: async () => {},
        fetchImpl: async () => { calls++; throw new Error('fetch failed') }
    })
    assert.equal(res.ok, false)
    assert.equal(calls, 3)

    let httpCalls = 0
    const http = await sendWecom('hi', {
        webhook: 'https://example.com/hook',
        sleep: async () => {},
        fetchImpl: async () => { httpCalls++; return await reply('boom', { ok: false, status: 502 })() }
    })
    assert.equal(http.ok, false)
    assert.equal(httpCalls, 3)
})

test('没有 webhook 与 dry-run 都不发送', async () => {
    let calls = 0
    const fetchImpl = async () => { calls++; return await reply({ errcode: 0 })() }
    assert.equal((await sendWecom('hi', { webhookFile: '/nonexistent/wecom.txt', fetchImpl })).ok, false)
    assert.match((await sendWecom('hi', { webhook: '', fetchImpl })).error, /未配置/)
    assert.equal((await sendWecom('hi', { webhook: 'https://example.com/hook', dryRun: true, fetchImpl })).ok, true)
    assert.equal(calls, 0)
})

test('maskSecret 遮住 webhook key 与密码', () => {
    const masked = maskSecret('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc123def456 EG_PASSWORD=hunter2')
    assert.match(masked, /key=\*\*\*\*/)
    assert.doesNotMatch(masked, /hunter2/)
    assert.doesNotMatch(masked, /abc123def456/)
})
