// 离线单测:网易云请求层 client.js。fetchImpl 全是桩,没有任何真实网络请求;
// 所有值都是 SAMPLE,不含任何真实凭据。协议出处(UA、表单、返回码)见 ../NOTICE。
import test from 'node:test'
import assert from 'node:assert/strict'

import { call, cookieValue, cryptoFromUrl, UA, HOSTS } from '../src/client.js'
import { eapiParams, PATHS } from '../src/crypto.js'
import { COOKIE, form, json, run, stub } from './support.js'

test('weapi 成功:路径正确、params 表单、UA/Cookie 透传', async () => {
  const { calls, fetchImpl } = stub(json({ code: 200, data: { sign: true } }))
  const result = await run({ fetchImpl })
  assert.deepEqual(result, {
    ok: true,
    code: 200,
    body: { code: 200, data: { sign: true } },
    raw: JSON.stringify({ code: 200, data: { sign: true } }),
    error: null,
    reason: 'ok',
  })
  assert.equal(calls[0].url, `https://music.163.com${PATHS.vipSign}`)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.Cookie, COOKIE)
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.match(calls[0].options.headers['User-Agent'], /Chrome/)
  assert.equal(calls[0].options.headers['User-Agent'], UA.weapi)
  assert.equal(calls[0].options.headers.Referer, 'https://music.163.com/')
  assert.ok(calls[0].options.signal)
  const body = form(calls[0].options.body)
  assert.ok(body.get('params') && body.get('encSecKey'))
})

test('eapi 成功:走 interfacepc 主机、params 是大写 hex、UA 是移动端', async () => {
  const { calls, fetchImpl } = stub(json({ code: 200, data: {} }))
  const result = await call({
    url: PATHS.vipCheckinDetail,
    crypto: 'eapi',
    data: { type: 1 },
    cookie: COOKIE,
    deps: { fetchImpl },
  })
  assert.equal(result.ok, true)
  assert.equal(calls[0].url, `https://interfacepc.music.163.com${PATHS.vipCheckinDetail}`)
  assert.match(calls[0].options.headers['User-Agent'], /NeteaseMusic/)
  assert.equal(calls[0].options.headers['User-Agent'], UA.eapi)
  assert.match(form(calls[0].options.body).get('params'), /^[0-9A-F]+$/)
})

test('eapi 摘要用请求路径:与 eapiParams(pathname) 一致', async () => {
  const { calls, fetchImpl } = stub(json({ code: 200 }))
  await call({
    url: PATHS.vipCheckinDetail,
    crypto: 'eapi',
    data: { type: 1 },
    cookie: COOKIE,
    deps: { fetchImpl },
  })
  const expected = eapiParams(PATHS.vipCheckinDetail, { type: 1 }).params
  assert.equal(form(calls[0].options.body).get('params'), expected)
})

test('crypto 省略时按路径前缀推断', () => {
  assert.equal(cryptoFromUrl(PATHS.vipSign), 'weapi')
  assert.equal(cryptoFromUrl(PATHS.vipCheckinDetail), 'eapi')
  assert.equal(cryptoFromUrl('/api/point/today/get'), 'none')
})

test('crypto=none:GET 时不带 body', async () => {
  const { calls, fetchImpl } = stub(json({ code: 200 }))
  await call({ url: '/api/x', crypto: 'none', data: { a: 1 }, cookie: COOKIE, deps: { fetchImpl } })
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.body, undefined)
})

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

test('业务 code 447/500 归一为 reason=http', async () => {
  for (const code of [447, 500]) {
    const { fetchImpl } = stub(json({ code }))
    const result = await run({ fetchImpl })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'http')
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

test('cookieValue 只取字段值,取不到返回 null', () => {
  assert.equal(cookieValue('a=1; MUSIC_U=abc; b=2', 'MUSIC_U'), 'abc')
  assert.equal(cookieValue('MUSIC_U=abc', 'MUSIC_U'), 'abc')
  assert.equal(cookieValue('MUSIC_A=x', 'MUSIC_U'), null)
  assert.equal(cookieValue('', 'MUSIC_U'), null)
})

test('HOSTS 常量集中导出', () => {
  assert.equal(HOSTS.weapi, 'https://music.163.com')
  assert.equal(HOSTS.eapi, 'https://interfacepc.music.163.com')
})
