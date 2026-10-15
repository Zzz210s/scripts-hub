// T4:VIP 乐签。协议形状按 2026-10-15 真机校正:
//   读状态(成长值 + 逐日记录)→ pace → POST /weapi/vip-center-bff/task/sign → pace → 再读一次
// 判定以签到动作的**业务字段**(code 200 且 data true)为准,不再依赖那条稳定 HTTP 400 的 eapi。
// 全部离线:fetchImpl 是桩,没有任何真实网络请求。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { judgeVipAction, judgeVipSign, readVipState, signVip } from '../src/vip.js'
import { PATHS } from '../src/crypto.js'
import { COOKIE, form } from './support.js'

const GROWTH = PATHS.vipGrowthPoint
const INFO = PATHS.vipSignInfo
const SIGN = PATHS.vipSign

const growthBody = ({ point = 7527, yesterday = 6, level = 4 } = {}) => ({
  code: 200,
  data: { userLevel: { level, growthPoint: point, yesterdayPoint: yesterday } },
})
const infoBody = ({ score = 3, today = '2026-10-15' } = {}) => ({
  code: 200,
  data: [{ timeStr: today, today: true, score }, { timeStr: '2026-10-14', today: false, score: 0 }],
})
const signBody = ({ code = 200, data = true } = {}) => ({ code, data, message: '' })

/** 按 URL 分派;`sign` 可以给对象或函数(按调用次数变化)。 */
const stubFetch = ({ growth = growthBody(), info = infoBody(), sign = signBody(), status = {}, throwOn = null } = {}) => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (throwOn && url.includes(throwOn)) throw new Error('ECONNRESET')
    const reply = url.includes(SIGN) ? sign : url.includes(GROWTH) ? growth : info
    const payload = typeof reply === 'function' ? reply(calls.length) : reply
    const code = status[url.includes(SIGN) ? 'sign' : url.includes(GROWTH) ? 'growth' : 'info'] ?? 200
    return { status: code, ok: code < 400, text: async () => JSON.stringify(payload) }
  }
  return { calls, fetchImpl }
}

const deps = (stub, extra = {}) => ({ fetchImpl: stub.fetchImpl, sleep: async () => {}, retries: 0, ...extra })

test('签到成功:先读状态再签到再读一次,业务字段确认 → businessOk=true、step=done', async () => {
  const stub = stubFetch()
  const result = await signVip({ cookie: COOKIE, deps: deps(stub) })
  assert.equal(result.ok, true)
  assert.equal(result.step, 'done')
  assert.equal(result.businessOk, true)
  assert.equal(result.before.growth.growthPoint, 7527)
  assert.equal(result.before.today.score, 3)
  // 三次调用:读成长值、读记录、签到;之后再读一次成长值与记录
  assert.equal(stub.calls.filter((c) => c.url.includes(SIGN)).length, 1)
  assert.equal(stub.calls.filter((c) => c.url.includes(GROWTH)).length, 2)
  assert.equal(stub.calls.filter((c) => c.url.includes(INFO)).length, 2)
  assert.equal(stub.calls.find((c) => c.url.includes(SIGN)).options.method, 'POST')
});

test('签到动作返回 data:false:businessOk=false、不算成功', async () => {
  const stub = stubFetch({ sign: signBody({ data: false }) })
  const result = await signVip({ cookie: COOKIE, deps: deps(stub) })
  assert.equal(result.step, 'sign')
  assert.equal(result.businessOk, false)
  assert.equal(result.ok, false)
});

test('签到动作 code 非 200:businessOk=false,不因为 HTTP 200 就算成功', async () => {
  const stub = stubFetch({ sign: signBody({ code: 250, data: true }) })
  const result = await signVip({ cookie: COOKIE, deps: deps(stub) })
  assert.equal(result.businessOk, false);
  assert.equal(result.ok, false)
});

test('签到动作形状不认识(没有 data):businessOk=null,不猜成功', async () => {
  const stub = stubFetch({ sign: { code: 200, message: 'ok' } })
  const result = await signVip({ cookie: COOKIE, deps: deps(stub) })
  assert.equal(result.businessOk, null)
  assert.equal(result.ok, false)
});

test('凭据失效(301):只发一次请求,当天熔断,不发读回', async () => {
  const stub = stubFetch({ sign: { code: 301, message: '未登录' }, status: { sign: 200 } })
  const result = await signVip({ cookie: COOKIE, deps: deps(stub) })
  assert.equal(result.step, 'sign')
  assert.equal(stub.calls.filter((c) => c.url.includes(SIGN)).length, 1)
  // 只读了开始前那次状态:签到之后没有再去读
  assert.equal(stub.calls.filter((c) => c.url.includes(GROWTH)).length, 1)
});

test('限流(业务 code 429 与 HTTP 429)都不重试、不发读回', async () => {
  for (const [label, sign, status] of [
    ['业务 code 429', { code: 429, message: '过于频繁' }, {}],
    ['HTTP 429', { code: 200, data: true }, { sign: 429 }],
  ]) {
    const stub = stubFetch({ sign, status })
    const result = await signVip({ cookie: COOKIE, deps: deps(stub, { retries: 0 }) })
    assert.equal(result.ok, false, label)
    assert.equal(stub.calls.filter((c) => c.url.includes(SIGN)).length, 1, label)
    assert.equal(stub.calls.filter((c) => c.url.includes(GROWTH)).length, 1, label)
  }
});

test('读状态失败时如实标出,但签到动作仍按自己的业务字段判定', async () => {
  const stub = stubFetch({ growth: { code: 500, message: 'boom' }, status: { growth: 500 } })
  const result = await signVip({ cookie: COOKIE, deps: deps(stub) })
  assert.equal(result.before.ok, false)
  assert.equal(result.before.growth.growthPoint, null)
  assert.equal(result.businessOk, true) // 签到动作自己回了 data:true
});

test('readVipState:把成长值与今天那一条读出来,形状不认识就是 null', async () => {
  const stub = stubFetch()
  const state = await readVipState({ cookie: COOKIE, deps: deps(stub) })
  assert.deepEqual(state.growth, { level: 4, growthPoint: 7527, yesterdayPoint: 6 })
  assert.deepEqual(state.today, { timeStr: '2026-10-15', score: 3 })
  const broken = await readVipState({ cookie: COOKIE, deps: deps(stubFetch({ growth: {}, info: {} })) })
  assert.deepEqual(broken.growth, { level: null, growthPoint: null, yesterdayPoint: null })
  assert.equal(broken.today, null)
});

test('真机夹具:签到动作与状态读回的真实形状', async () => {
  const action = JSON.parse(readFileSync(new URL('./fixtures/vip-sign-action-ok.json', import.meta.url), 'utf8'))
  assert.equal(judgeVipAction(action), true)
  assert.equal(judgeVipAction({ code: 200, data: false }), false)
  assert.equal(judgeVipAction({ code: 200 }), null)
  assert.equal(judgeVipAction(null), null)
});

test('judgeVipSign:动作给出明确答案时以它为准,否则未能确认', () => {
  assert.equal(judgeVipSign(true, { timeStr: '2026-10-15', score: 3 }), true)
  assert.equal(judgeVipSign(false, null), false)
  assert.equal(judgeVipSign(null, { timeStr: '2026-10-15', score: 3 }), null)
});

test('body 里的 weapi 参数仍然加密(form 里是 params/encSecKey)', async () => {
  const stub = stubFetch()
  await signVip({ cookie: COOKIE, deps: deps(stub) })
  const action = stub.calls.find((c) => c.url.includes(SIGN))
  const body = form(action.options.body)
  assert.ok(body.get('params'))
  assert.ok(body.get('encSecKey'))
});
