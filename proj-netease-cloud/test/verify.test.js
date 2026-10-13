// T6:结果判定矩阵与基线的离线单测。纯函数,无 IO、无网络。
// 覆盖设计文档第 5 节「请求结果的处理矩阵」的每一行。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTH_CODES,
  BASELINE_KEYS,
  assessGrowth,
  businessAction,
  classifyError,
  day0Baseline,
  deltaFromBaseline,
  nextAction,
} from '../src/verify.js'
import { AUTH_CODES as CLIENT_AUTH_CODES } from '../src/client.js'

test('处理矩阵 · 登录失效类(301/302/8810/-462/-460/447/401/403 + client reason)→ auth', () => {
  for (const code of [301, 302, 8810, -462, -460, 447]) {
    assert.equal(classifyError({ code }), 'auth', `code ${code} 应归 auth`)
  }
  assert.equal(classifyError({ httpStatus: 401 }), 'auth')
  assert.equal(classifyError({ httpStatus: 403 }), 'auth')
  // client.js 归一后的真实形状:reason 与 error 文案都带
  assert.equal(
    classifyError({ code: 301, error: '未登录或凭据已失效 · code 301', reason: 'auth' }),
    'auth',
  )
  assert.equal(classifyError({ reason: 'no-cookie', error: 'cookie 里没有 MUSIC_U · 只用 MUSIC_U' }), 'auth')
})

test('处理矩阵 · 限流/过于频繁 → rate-limit', () => {
  assert.equal(classifyError({ httpStatus: 429 }), 'rate-limit')
  assert.equal(classifyError({ code: 429 }), 'rate-limit')
  assert.equal(classifyError({ httpStatus: 200, error: '接口返回失败 · 操作过于频繁' }), 'rate-limit')
})

test('处理矩阵 · 网络异常/超时 → network', () => {
  assert.equal(classifyError({ reason: 'network' }), 'network')
  assert.equal(classifyError({ error: '请求超时' }), 'network')
  assert.equal(classifyError({ error: '网络错误 · fetch failed' }), 'network')
})

test('处理矩阵 · 接口返回结构变了 → shape', () => {
  assert.equal(classifyError({ httpStatus: 500 }), 'shape')
  assert.equal(classifyError({ reason: 'parse', error: '响应不是 JSON · <html>' }), 'shape')
  assert.equal(classifyError({ code: 250 }), 'shape')
})

test('classifyError · 正常 → ok', () => {
  assert.equal(classifyError({ code: 200 }), 'ok')
  assert.equal(classifyError({}), 'ok')
  assert.equal(classifyError({ code: null, reason: 'ok', error: null }), 'ok')
})

test('nextAction · 登录失效与限流都不重试、当天熔断并推 action', () => {
  assert.equal(nextAction('auth', 0), 'circuit-break-and-notify')
  assert.equal(nextAction('rate-limit', 0), 'circuit-break-and-notify')
  assert.equal(nextAction('auth', 3), 'circuit-break-and-notify')
})

test('nextAction · 网络异常只重试一次,之后放弃', () => {
  assert.equal(nextAction('network', 0), 'retry-once')
  assert.equal(nextAction('network', 1), 'fail')
  assert.equal(nextAction('network', 9), 'fail')
})

test('nextAction · 结构变了直接失败;ok 不需要动作', () => {
  assert.equal(nextAction('shape', 0), 'fail')
  assert.equal(nextAction('ok', 0), null)
})

test('nextAction · 未识别的 kind 一律 fail,不静默当成功', () => {
  assert.equal(nextAction('bogus', 0), 'fail')
  assert.equal(nextAction(undefined, 0), 'fail')
})

test('AUTH_CODES 只有一份真源:verify 复用的就是 client 的同一数组', () => {
  assert.equal(AUTH_CODES, CLIENT_AUTH_CODES)
  assert.ok(AUTH_CODES.includes(447))
})

test('处理矩阵 · HTTP 200 但业务未成功:判失败且不重试', () => {
  assert.equal(businessAction(true), null)
  assert.equal(businessAction(false), 'fail')
  // 字段缺失、无法确认时同样不当作成功
  assert.equal(businessAction(null), 'fail')
})

test('day0Baseline · 首次运行采基线,之后原样保留', () => {
  const snapshot = { yunbei: 88, growthPoint: 1200, extra: 'ignored' }
  const first = day0Baseline({}, snapshot)
  assert.deepEqual(first, { yunbei: 88, growthPoint: 1200 })
  assert.deepEqual(BASELINE_KEYS, ['yunbei', 'growthPoint'])
  // 已有基线:不因当天数值变化而改写(基线只在 day0 采一次)
  const kept = day0Baseline({ baseline: first }, { yunbei: 999, growthPoint: 1300 })
  assert.deepEqual(kept, { yunbei: 88, growthPoint: 1200 })
  assert.deepEqual(first, { yunbei: 88, growthPoint: 1200 })
})

test('deltaFromBaseline · 无基线返回 null(回归:不能拿「较昨日增长」当唯一证据)', () => {
  assert.equal(deltaFromBaseline({}, { yunbei: 88 }), null)
  assert.equal(deltaFromBaseline(null, { yunbei: 88 }), null)
})

test('deltaFromBaseline · 有基线算差值,缺字段如实为 null', () => {
  const state = { baseline: { yunbei: 88, growthPoint: 1200 } }
  assert.deepEqual(deltaFromBaseline(state, { yunbei: 90, growthPoint: 1210 }), {
    yunbei: 2,
    growthPoint: 10,
  })
  assert.deepEqual(deltaFromBaseline(state, { yunbei: 90 }), { yunbei: 2, growthPoint: null })
  assert.deepEqual(deltaFromBaseline(state, { yunbei: 'x', growthPoint: 1210 }), {
    yunbei: null,
    growthPoint: 10,
  })
})

test('assessGrowth · 无基线退化为绝对值口径(回归用例)', () => {
  const day0 = assessGrowth({}, { yunbei: 88, growthPoint: 1200 })
  assert.equal(day0.mode, 'absolute')
  assert.equal(day0.delta, null)
  assert.deepEqual(day0.absolute, { yunbei: 88, growthPoint: 1200 })
})

test('assessGrowth · 有基线时给双口径', () => {
  const state = { baseline: { yunbei: 88, growthPoint: 1200 } }
  const day1 = assessGrowth(state, { yunbei: 90, growthPoint: 1210 })
  assert.equal(day1.mode, 'baseline')
  assert.deepEqual(day1.delta, { yunbei: 2, growthPoint: 10 })
  assert.deepEqual(day1.absolute, { yunbei: 90, growthPoint: 1210 })
})
