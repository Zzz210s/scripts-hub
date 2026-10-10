import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sendWecom, maskSecret, truncateText, loadWebhook } from '../src/notify.js'

const okResponse = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ errcode: 0, errmsg: 'ok' }) })
const errResponse = (errcode) => ({ ok: true, status: 200, text: async () => JSON.stringify({ errcode, errmsg: 'no' }) })

test('errcode 0 成功', async () => {
    const result = await sendWecom('hi', { webhook: 'https://example.com/hook', fetchImpl: async () => okResponse() })
    assert.deepEqual(result, { ok: true })
})

test('45009 退避后成功;其余 errcode 不重试', async () => {
    let calls = 0
    const sleeps = []
    const result = await sendWecom('hi', {
        webhook: 'https://example.com/hook',
        retries: 2,
        sleep: async (ms) => sleeps.push(ms),
        fetchImpl: async () => { calls += 1; return calls === 1 ? errResponse(45009) : okResponse() }
    })
    assert.deepEqual(result, { ok: true })
    assert.equal(calls, 2)
    assert.deepEqual(sleeps, [1000])

    let other = 0
    const bad = await sendWecom('hi', {
        webhook: 'https://example.com/hook',
        retries: 2,
        sleep: async () => {},
        fetchImpl: async () => { other += 1; return errResponse(40001) }
    })
    assert.equal(bad.ok, false)
    assert.equal(bad.errcode, 40001)
    assert.equal(other, 1)
})

test('超时按可重试处理,重试用尽后失败', async () => {
    let calls = 0
    const result = await sendWecom('hi', {
        webhook: 'https://example.com/hook',
        retries: 1,
        sleep: async () => {},
        fetchImpl: async () => { calls += 1; const error = new Error('aborted'); error.name = 'AbortError'; throw error }
    })
    assert.equal(result.ok, false)
    assert.equal(calls, 2)
})

test('maskSecret 把 key= 脱敏', () => {
    assert.equal(maskSecret('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdef123456'), 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=****')
    assert.equal(maskSecret('key=short'), 'key=short')
})

test('truncateText 按 UTF-8 截断,不切半个汉字,总长 <= 2048', () => {
    const out = truncateText('汉'.repeat(2000))
    assert.ok(Buffer.byteLength(out, 'utf8') <= 2048)
    assert.ok(!out.endsWith('\uFFFD'))
    assert.ok(out.endsWith('...'))
    assert.equal(truncateText('短'), '短')
})

test('没有 webhook 时不抛', async () => {
    const result = await sendWecom('hi', { webhookFile: '/definitely/not/here.txt', fetchImpl: async () => { throw new Error('不应调用') } })
    assert.deepEqual(result, { ok: false, error: '未配置企业微信 webhook' })
})

test('dryRun 不发送', async () => {
    const result = await sendWecom('hi', { dryRun: true, webhook: 'https://example.com/hook' })
    assert.equal(result.note, 'dry-run 未发送')
})

test('loadWebhook 读文件并去空白', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bili-hook-')), 'hook.txt')
    fs.writeFileSync(file, '  https://example.com/hook\n')
    assert.equal(loadWebhook(file), 'https://example.com/hook')
    assert.equal(loadWebhook('/definitely/not/here.txt'), '')
})
