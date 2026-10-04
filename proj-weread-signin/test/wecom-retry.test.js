// wecom-core 退避重试规则(与微软积分 wechat-bridge 侧同一套核心块):
// 只有限流 45009 值得退避重试;其余 errcode 立即失败,不重试;网络/超时按既有策略重试。
import assert from 'node:assert/strict'
import test from 'node:test'

import { sendWecom } from '../src/notify.js'

const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test'
const ok = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ errcode: 0, errmsg: 'ok' }) })
const denied = code => ({ ok: true, status: 200, text: async () => JSON.stringify({ errcode: code, errmsg: 'denied' }) })

/** 按脚本依次给出响应或抛错;记录 fetch 次数与 sleep 节奏。 */
function stub(script) {
    const calls = { fetch: 0, sleep: [] }
    const fetchImpl = async () => {
        const step = script[calls.fetch] ?? script[script.length - 1]
        calls.fetch += 1
        if (step instanceof Error) throw step
        return step
    }
    const sleep = async ms => { calls.sleep.push(ms) }
    return { calls, fetchImpl, sleep }
}

test('45009 限流:退避重试一次后成功', async () => {
    const { calls, fetchImpl, sleep } = stub([denied(45009), ok()])
    const res = await sendWecom('hi', { webhook: WEBHOOK, fetchImpl, sleep })
    assert.equal(res.ok, true)
    assert.equal(calls.fetch, 2)
    assert.deepEqual(calls.sleep, [1000])
})

test('45009 限流:重试耗尽后如实返回失败', async () => {
    const { calls, fetchImpl, sleep } = stub([denied(45009)])
    const res = await sendWecom('hi', { webhook: WEBHOOK, fetchImpl, sleep, retries: 1 })
    assert.equal(res.ok, false)
    assert.match(res.error, /errcode=45009/)
    assert.equal(calls.fetch, 2)
    assert.deepEqual(calls.sleep, [1000])
})

test('非 45009 的 errcode 立即失败,不重试', async () => {
    for (const code of [93000, 93004]) {
        const { calls, fetchImpl, sleep } = stub([denied(code)])
        const res = await sendWecom('hi', { webhook: WEBHOOK, fetchImpl, sleep })
        assert.equal(res.ok, false)
        assert.match(res.error, new RegExp(`errcode=${code}`))
        assert.equal(calls.fetch, 1)
        assert.deepEqual(calls.sleep, [])
    }
})

test('网络异常按既有策略指数退避重试,耗尽后失败', async () => {
    const { calls, fetchImpl, sleep } = stub([new Error('boom')])
    const res = await sendWecom('hi', { webhook: WEBHOOK, fetchImpl, sleep, retries: 2 })
    assert.equal(res.ok, false)
    assert.match(res.error, /boom/)
    assert.equal(calls.fetch, 3)
    assert.deepEqual(calls.sleep, [1000, 2000])
})

test('超时(AbortController)按可重试失败处理', async () => {
    let n = 0
    const fetchImpl = (url, opts) => {
        n += 1
        if (n === 1) {
            return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))))
        }
        return Promise.resolve(ok())
    }
    const res = await sendWecom('hi', { webhook: WEBHOOK, fetchImpl, sleep: async () => {}, timeoutMs: 10 })
    assert.equal(res.ok, true)
    assert.equal(n, 2)
})
