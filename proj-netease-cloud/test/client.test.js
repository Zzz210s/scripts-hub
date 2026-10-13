// 离线单测:网易云请求层 client.js 的成功路径与参数契约。fetchImpl 全是桩,没有真实网络请求。
// 失败归一、重试与 reason 契约在 client-errors.test.js。所有值都是 SAMPLE,不含真实凭据。
import test from 'node:test'
import assert from 'node:assert/strict'

import { call, cookieValue, cryptoFromUrl, UA, HOSTS } from '../src/client.js'
import { PATHS } from '../src/crypto.js'
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

test('eapi 摘要用逻辑路径:client 实际发出的 params 等于固定向量', async () => {
  const { calls, fetchImpl } = stub(json({ code: 200 }))
  await call({
    url: PATHS.vipCheckinDetail,
    crypto: 'eapi',
    data: { signDayTime: 1700000000000, type: 1 },
    cookie: COOKIE,
    deps: { fetchImpl },
  })
  // 固定向量由参考实现生成(生成方式见 crypto.test.js),算的是 /api/... 逻辑路径;
  // client 发到 /eapi/... 的机器上,但加密里必须归一成 /api/...。若退化成自比自就抓不到回归。
  assert.equal(
    form(calls[0].options.body).get('params'),
    'E422E21FE1C070374FA6D7A8393DDEC2ED97FD2EC324E8E3B7BB732434535F4F' +
      'C587F341F28425647A9FB58D2AB4F7C5E14D621EB896C63E8E0FBC1DFA867E56' +
      '6784A253A01DB24530DF8336582F4CC4443DCCEDE55892A6F739E5D44F007D43' +
      'D9B22F27D01CA0B90677BB0A11E4D15EB005FCCE467CAE575D6D25BD2D3A9EBF' +
      '09775E2D7D4462F93294872C1944276B00731E665A87F4CAD5295723AFC3EE63',
  )
  assert.equal(calls[0].url, `https://interfacepc.music.163.com${PATHS.vipCheckinDetail}`)
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

test('业务 code 非数字:按未解析处理,code 归一为 null', async () => {
  const { fetchImpl } = stub(json({ code: 'not-a-number' }))
  const result = await run({ fetchImpl })
  assert.equal(result.code, null)
  assert.equal(result.reason, 'ok')
  assert.equal(result.error, null)
  assert.equal(String(result.error).includes('NaN'), false)
})

test('cookieValue 只取字段值,取不到或为空都返回 null', () => {
  assert.equal(cookieValue('a=1; MUSIC_U=abc; b=2', 'MUSIC_U'), 'abc')
  assert.equal(cookieValue('MUSIC_U=abc', 'MUSIC_U'), 'abc')
  assert.equal(cookieValue('MUSIC_A=x', 'MUSIC_U'), null)
  assert.equal(cookieValue('', 'MUSIC_U'), null)
  assert.equal(cookieValue('MUSIC_U=', 'MUSIC_U'), null)
  assert.equal(cookieValue('MUSIC_U=; a=1', 'MUSIC_U'), null)
})

test('cookie 值为空:不发请求,reason=no-cookie', async () => {
  const { calls, fetchImpl } = stub(json({ code: 200 }))
  const result = await call({
    url: PATHS.vipSign,
    crypto: 'weapi',
    data: {},
    cookie: 'MUSIC_U=',
    deps: { fetchImpl },
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-cookie')
  assert.equal(calls.length, 0)
})

test('HOSTS 常量集中导出', () => {
  assert.equal(HOSTS.weapi, 'https://music.163.com')
  assert.equal(HOSTS.eapi, 'https://interfacepc.music.163.com')
})
