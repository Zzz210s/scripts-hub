// T5:云贝只读查询的离线单测。只读、不签到(设计文档范围 A2);
// fetchImpl 全是桩,没有真实网络请求。字段形状来自调研文档,待 T3 探针校正。
import test from 'node:test'
import assert from 'node:assert/strict'

import { queryYunbei, readBalance, readSigned, renderYunbeiLine } from '../src/yunbei.js'
import { PATHS } from '../src/crypto.js'
import { COOKIE } from './support.js'

/** 按调用次序返回预置响应的桩;记录 url 与 sleep 入参。 */
function scripted(replies) {
  const calls = []
  const sleeps = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]
    const status = reply?.status ?? 200
    return { ok: status < 400, status, text: async () => JSON.stringify(reply?.body ?? {}) }
  }
  const sleep = async (ms) => {
    sleeps.push(ms)
  }
  return { calls, sleeps, fetchImpl, sleep }
}

test('查询成功:余额与今日已签都取到,渲染一行', async () => {
  const { calls, sleeps, fetchImpl, sleep } = scripted([
    { body: { code: 200, data: { sign: true, yunbeiNum: 1234 } } },
    { body: { code: 200, data: { yunbeiNum: 1234 } } },
  ])
  const result = await queryYunbei({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.ok, true)
  assert.equal(result.balance, 1234)
  assert.equal(result.signedToday, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, `https://music.163.com${PATHS.yunbeiSignedGet}`)
  assert.equal(calls[1].url, `https://music.163.com${PATHS.yunbeiTodayGet}`)
  // 串行且间隔不低于 3 秒。
  assert.equal(sleeps.length, 1)
  assert.ok(sleeps[0] >= 3000, `请求间隔应 >=3000ms,实际 ${sleeps[0]}`)
  assert.equal(renderYunbeiLine(result), '云贝:余额 1234 · 今日已签')
})

test('今日未签:渲染未签', async () => {
  const { fetchImpl, sleep } = scripted([
    { body: { code: 200, data: { sign: false, yunbeiNum: 1200 } } },
    { body: { code: 200, data: { yunbeiNum: 1200 } } },
  ])
  const result = await queryYunbei({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.signedToday, false)
  assert.equal(renderYunbeiLine(result), '云贝:余额 1200 · 今日未签')
})

test('接口需要加密而失败:ok=false 且渲染「暂不可用」,不崩不谎报', async () => {
  const { calls, fetchImpl, sleep } = scripted([{ body: { code: -462 } }])
  const result = await queryYunbei({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.ok, false)
  assert.equal(result.balance, null)
  assert.equal(result.signedToday, null)
  assert.equal(calls.length, 1)
  assert.equal(renderYunbeiLine(result), '云贝:暂不可用')
})

test('余额只出现在第二段:回退取今日接口的余额', async () => {
  const { fetchImpl, sleep } = scripted([
    { body: { code: 200, data: { sign: true } } },
    { body: { code: 200, data: { yunbeiNum: 88 } } },
  ])
  const result = await queryYunbei({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.ok, true)
  assert.equal(result.balance, 88)
  assert.equal(renderYunbeiLine(result), '云贝:余额 88 · 今日已签')
})

test('余额字段缺失:渲染「余额未知」而不是编一个数', async () => {
  const { fetchImpl, sleep } = scripted([
    { body: { code: 200, data: { sign: true } } },
    { body: { code: 200, data: {} } },
  ])
  const result = await queryYunbei({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.ok, true)
  assert.equal(result.balance, null)
  assert.equal(renderYunbeiLine(result), '云贝:余额未知 · 今日已签')
})

test('签到状态字段缺失:渲染「签到状态未知」', async () => {
  const { fetchImpl, sleep } = scripted([
    { body: { code: 200, data: { yunbeiNum: 33 } } },
    { body: { code: 200, data: { yunbeiNum: 33 } } },
  ])
  const result = await queryYunbei({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.signedToday, null)
  assert.equal(renderYunbeiLine(result), '云贝:余额 33 · 签到状态未知')
})

test('第二段失败不回退成假成功:ok 仍 true,但缺的字段如实为 null', async () => {
  const { fetchImpl, sleep } = scripted([
    { body: { code: 200, data: { sign: true, yunbeiNum: 7 } } },
    { status: 500, body: { code: 500 } },
  ])
  const result = await queryYunbei({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.ok, true)
  assert.equal(result.balance, 7)
  assert.equal(result.signedToday, true)
  assert.equal(result.raw.today.ok, false)
})

test('renderYunbeiLine:空值与 ok 非真一律「暂不可用」', () => {
  assert.equal(renderYunbeiLine(null), '云贝:暂不可用')
  assert.equal(renderYunbeiLine({ ok: false }), '云贝:暂不可用')
  assert.equal(renderYunbeiLine({ ok: true, balance: 0, signedToday: false }), '云贝:余额 0 · 今日未签')
})

test('readSigned / readBalance:只认明确字段,缺失返回 null', () => {
  assert.equal(readSigned({ data: { sign: true } }), true)
  assert.equal(readSigned({ data: { sign: 0 } }), false)
  assert.equal(readSigned({ data: { sign: 'yes' } }), null)
  assert.equal(readSigned(null), null)
  assert.equal(readBalance({ data: { yunbeiNum: 12 } }), 12)
  assert.equal(readBalance({ data: { balance: '34' } }), 34)
  assert.equal(readBalance({ data: { balance: 'abc' } }), null)
  assert.equal(readBalance({ data: {} }), null)
  assert.equal(readBalance(undefined), null)
})
