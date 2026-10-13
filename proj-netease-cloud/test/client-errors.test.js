// 离线单测:请求层的失败归一、退避重试与 reason 契约。fetchImpl 全是桩,没有真实网络请求。
// 成功路径与参数契约在 client.test.js。所有值都是 SAMPLE,不含任何真实凭据。
import test from 'node:test'
import assert from 'node:assert/strict'

import { call } from '../src/client.js'
import { PATHS } from '../src/crypto.js'
import { json, run, stub } from './support.js'

test('HTTP 500 归一为 ok:false/reason=http,不抛', async () => {
  const { fetchImpl } = stub(() => ({ status: 500, text: '<html>boom</html>' }))
  const result = await run({ fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'http')
  assert.equal(result.code, null)
  assert.match(result.error, /500/)
})

test('超时归一为 ok:false/reason=network,不抛', async () => {
  const { fetchImpl } = stub(() => ({ text: '{}' }))
  const hanging = (url, options) => {
    fetchImpl(url, options)
    return new Promise(() => {})
  }
  const result = await run({ fetchImpl: hanging, deps: { timeoutMs: 5 } })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'network')
  assert.match(result.error, /超时/)
})

test('响应不是 JSON 归一为 ok:false/reason=parse', async () => {
  const { fetchImpl } = stub(() => ({ text: '<html>login</html>' }))
  const result = await run({ fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'parse')
  assert.equal(result.raw, '<html>login</html>')
})

test('网络抛错归一为 ok:false/reason=network', async () => {
  const { fetchImpl } = stub(() => ({ throw: new Error('ECONNRESET') }))
  const result = await run({ fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'network')
  assert.match(result.error, /ECONNRESET/)
})

test('cookie 缺失:不发请求,reason=no-cookie', async () => {
  const { calls, fetchImpl } = stub(json({ code: 200 }))
  const result = await call({ url: PATHS.vipSign, crypto: 'weapi', data: {}, cookie: '', deps: { fetchImpl } })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-cookie')
  assert.equal(calls.length, 0)
})

test('业务 code 301 归一为 reason=auth,并带出 code', async () => {
  const { fetchImpl } = stub(json({ code: 301, msg: '需要登录' }))
  const result = await run({ fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'auth')
  assert.equal(result.code, 301)
  assert.match(result.error, /301/)
})

test('业务 code 447 归一为 reason=auth(风控/鉴权态),500 归一为 reason=http', async () => {
  for (const [code, reason] of [[447, 'auth'], [500, 'http']]) {
    const { fetchImpl } = stub(json({ code }))
    const result = await run({ fetchImpl })
    assert.equal(result.ok, false)
    assert.equal(result.reason, reason)
    assert.equal(result.code, code)
  }
})

test('每个失败结果形状一致:ok:false + 字符串 error/reason,且不抛', async () => {
  const cases = [
    () => stub(() => ({ status: 403, text: 'no' })),
    () => stub(() => ({ text: 'not json' })),
    () => stub(() => ({ throw: new Error('boom') })),
    () => stub(json({ code: 301 })),
    () => stub(json({ code: 500 })),
  ]
  for (const make of cases) {
    const { fetchImpl } = make()
    const result = await run({ fetchImpl })
    assert.equal(result.ok, false)
    assert.equal(typeof result.error, 'string')
    assert.equal(typeof result.reason, 'string')
    assert.equal(result.error.includes('('), false, '错误文案不用圆括号')
  }
})

test('network 失败按 deps.retries 退避重试,sleep 可注入', async () => {
  let seen = 0
  const { calls, fetchImpl } = stub(() => {
    seen += 1
    return seen === 1 ? { throw: new Error('ECONNRESET') } : { text: JSON.stringify({ code: 200 }) }
  })
  const slept = []
  const result = await run({
    fetchImpl,
    deps: { retries: 1, retryDelayMs: 7, sleep: async (ms) => slept.push(ms) },
  })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 2)
  assert.deepEqual(slept, [7])
})

test('auth 与 parse 失败不重试,只重试 network', async () => {
  let seen = 0
  const { calls, fetchImpl } = stub(() => {
    seen += 1
    return { text: JSON.stringify({ code: 301 }) }
  })
  const result = await run({ fetchImpl, deps: { retries: 2, sleep: async () => {} } })
  assert.equal(result.reason, 'auth')
  assert.equal(calls.length, 1)
  assert.equal(seen, 1)
})
