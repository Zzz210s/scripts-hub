import assert from 'node:assert/strict'
import test from 'node:test'

import { clampText, sendWecom, WecomError } from '../src/wecom.js'
import { isWebhookUrl, maskWebhook, resolveWebhook } from '../src/webhook.js'

const VALID_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=00000000-1111-2222-3333-444444444444'

test('clampText 按 UTF-8 字节截断且保留可读结尾', () => {
    const short = '中文内容'
    assert.equal(clampText(short, 100), short)

    const long = '中'.repeat(100)
    const clamped = clampText(long, 30)
    assert.ok(Buffer.byteLength(clamped, 'utf8') <= 30)
    assert.ok(clamped.endsWith('...'))
})

test('isWebhookUrl 只接受企业微信发送接口地址', () => {
    assert.equal(isWebhookUrl(VALID_URL), true)
    assert.equal(isWebhookUrl('https://example.com/hook'), false)
    assert.equal(isWebhookUrl(`${VALID_URL} `), true)
})

test('maskWebhook 不泄露 key', () => {
    const masked = maskWebhook(VALID_URL)
    assert.equal(masked.includes('4444'), false)
    assert.equal(masked.includes('0000'), false)
    assert.ok(masked.endsWith('key=****'))
})

test('resolveWebhook 优先级:参数 > 环境变量 > 文件', () => {
    const env = { WECOM_WEBHOOK_URL: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=env' }
    assert.equal(resolveWebhook({ url: VALID_URL, env }).source, '参数 --webhook')
    assert.equal(resolveWebhook({ env }).source, '环境变量 WECOM_WEBHOOK_URL')
    assert.throws(() => resolveWebhook({ env: {}, cwd: '/nonexistent-dir' }), /未找到 webhook/)
})

test('dry-run 在未配置 webhook 时也能看到内容', async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const run = promisify(execFile)

    const { stdout } = await run(process.execPath, ['cli.js', '--dry-run', '内容'], {
        cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
    })

    assert.ok(stdout.includes('内容'))
})

test('sendWecom 网络失败会重试,成功后返回响应', async () => {
    let calls = 0
    const fetchImpl = async () => {
        calls += 1
        if (calls === 1) throw new Error('socket hang up')
        return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 })
    }

    const result = await sendWecom('测试', {
        webhookUrl: VALID_URL,
        fetchImpl,
        sleep: async () => {}
    })

    assert.equal(calls, 2)
    assert.equal(result.errcode, 0)
})

test('sendWecom 对 errcode 拒绝不重试', async () => {
    let calls = 0
    const fetchImpl = async () => {
        calls += 1
        return new Response(JSON.stringify({ errcode: 93000, errmsg: 'invalid webhook url' }), { status: 200 })
    }

    await assert.rejects(
        () => sendWecom('测试', { webhookUrl: VALID_URL, fetchImpl, sleep: async () => {} }),
        error => error instanceof WecomError && error.errcode === 93000
    )
    assert.equal(calls, 1)
})

test('sendWecom 拒绝空内容', async () => {
    await assert.rejects(() => sendWecom('   ', { webhookUrl: VALID_URL }), /非空文本/)
})
