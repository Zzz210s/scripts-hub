// T5:云贝只读查询的离线单测。只读、不签到(设计文档范围 A2);
// fetchImpl 全是桩,没有真实网络请求。字段形状按 2026-10-15 真机实测:
//   /weapi/point/signed/get → {code:200,data:{days,shells}}
//   /weapi/point/today/get  → {code:200,data:{shells}}
import test from 'node:test'
import assert from 'node:assert/strict'

import { queryYunbei, renderYunbeiLine } from '../src/yunbei.js'
import { readYunbei, readGrowth, readToday } from '../src/fields.js'
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

test('查询成功:连续天数/本次贝壳/今日所得都取到,渲染一行', async () => {
  const { calls, sleeps, fetchImpl, sleep } = scripted([
    { body: { code: 200, data: { days: 0, shells: 1 } } },
    { body: { code: 200, data: { shells: 0 } } },
  ])
  const result = await queryYunbei({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.ok, true)
  assert.equal(result.days, 0)
  assert.equal(result.shells, 1)
  assert.equal(result.todayShells, 0)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, `https://music.163.com${PATHS.yunbeiSignedGet}`)
  assert.equal(calls[1].url, `https://music.163.com${PATHS.yunbeiTodayGet}`)
  // 串行且间隔不低于 3 秒。
  assert.equal(sleeps.length, 1)
  assert.ok(sleeps[0] >= 3000, `请求间隔应 >=3000ms,实际 ${sleeps[0]}`)
  assert.equal(renderYunbeiLine(result), '云贝:今日 +0 · 连续 0 天 · 本次 1')
})

test('字段缺失:渲染「未知」而不是编一个数', async () => {
  const { fetchImpl, sleep } = scripted([
    { body: { code: 200, data: { days: 'x' } } },
    { body: { code: 200, data: {} } },
  ])
  const result = await queryYunbei({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.ok, true)
  assert.equal(result.days, null)
  assert.equal(result.shells, null)
  assert.equal(result.todayShells, null)
  assert.equal(renderYunbeiLine(result), '云贝:今日 +未知 · 连续未知')
})

test('第一段失败:ok=false,渲染「暂不可用」,且不再发第二段', async () => {
  const { calls, fetchImpl, sleep } = scripted([{ status: 500, body: { code: 500 } }])
  const result = await queryYunbei({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.ok, false)
  assert.equal(calls.length, 1)
  assert.equal(renderYunbeiLine(result), '云贝:暂不可用')
})

test('第二段失败:ok 仍 true,今日所得如实为 null,不谎报', async () => {
  const { fetchImpl, sleep } = scripted([
    { body: { code: 200, data: { days: 3, shells: 2 } } },
    { status: 500, body: { code: 500 } },
  ])
  const result = await queryYunbei({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.ok, true)
  assert.equal(result.days, 3)
  assert.equal(result.todayShells, null)
  assert.equal(renderYunbeiLine(result), '云贝:今日 +未知 · 连续 3 天 · 本次 2')
})

test('renderYunbeiLine:空值与 ok 非真一律「暂不可用」', () => {
  assert.equal(renderYunbeiLine(null), '云贝:暂不可用')
  assert.equal(renderYunbeiLine({ ok: false }), '云贝:暂不可用')
});

test('readYunbei / readGrowth / readToday:只认明确的字段形状,其余 null', () => {
  assert.deepEqual(readYunbei({ data: { days: 5, shells: 3 } }, { data: { shells: 1 } }), {
    days: 5,
    shells: 3,
    todayShells: 1,
  })
  assert.deepEqual(readYunbei({ data: {} }, null), { days: null, shells: null, todayShells: null })
  assert.deepEqual(readGrowth({ data: { userLevel: { level: 4, growthPoint: 100, yesterdayPoint: 6 } } }), {
    level: 4,
    growthPoint: 100,
    yesterdayPoint: 6,
  })
  assert.deepEqual(readGrowth({ data: {} }), { level: null, growthPoint: null, yesterdayPoint: null })
  const now = new Date('2026-10-15T10:00:00')
  assert.deepEqual(readToday({ data: [{ timeStr: '2026-10-14', today: false, score: 0 }, { timeStr: '2026-10-15', today: true, score: 3 }] }, now), {
    timeStr: '2026-10-15',
    score: 3,
  })
  assert.equal(readToday({ data: [] }, now), null)
  assert.equal(readToday({ data: 'nope' }, now), null)
});
