// T4:VIP 乐签两条请求 + 读回判定的离线单测。fetchImpl 全是桩,没有真实网络请求。
// 夹具 test/fixtures/vip-*.json 目前是「按调研文档推断的形状」的脱敏占位样本
// (字段名来自 api-enhanced issue #197/#234 的 data.sign),待 T3 探针跑通后用真实响应替换。
// 待 T3 校正的字段清单见 .superpowers/.../task-4-6-report.md 与 NOTICE。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDecipheriv } from 'node:crypto'

import { judgeVipSign, readSignState, signVip } from '../src/vip.js'
import { CRYPTO, PATHS } from '../src/crypto.js'
import { COOKIE, form } from './support.js'

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

/** 按调用次序返回预置响应的桩;同时记录 url/body 与 sleep 的入参。 */
function scripted(replies) {
  const calls = []
  const sleeps = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]
    if (reply?.throwError) throw reply.throwError
    const status = reply?.status ?? 200
    return { ok: status < 400, status, text: async () => JSON.stringify(reply?.body ?? {}) }
  }
  const sleep = async (ms) => {
    sleeps.push(ms)
  }
  return { calls, sleeps, fetchImpl, sleep }
}

/** 解开 eapi 表单里的密文,拿回逻辑路径与实际入参,用于断言第二条请求的内容。 */
function eapiPlain(paramsHex) {
  const decipher = createDecipheriv('aes-128-ecb', Buffer.from(CRYPTO.eapiAesKey, 'utf8'), null)
  const text = Buffer.concat([
    decipher.update(Buffer.from(paramsHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
  const [url, data] = text.split(CRYPTO.eapiSeparator)
  return { url, data: JSON.parse(data) }
}

test('两条请求都成功且业务字段显示已签:businessOk=true、step=done', async () => {
  const { calls, sleeps, fetchImpl, sleep } = scripted([
    { body: fixture('vip-sign-ok.json') },
    { body: fixture('vip-checkin-ok.json') },
  ])
  const result = await signVip({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.ok, true)
  assert.equal(result.step, 'done')
  assert.equal(result.businessOk, true)
  assert.equal(result.before, true)
  assert.equal(result.after, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, `https://music.163.com${PATHS.vipSign}`)
  assert.equal(calls[1].url, `https://interfacepc.music.163.com${PATHS.vipCheckinDetail}`)
  // 单账号串行:两条之间必须等一次,且间隔不低于 3 秒(设计文档第 5 节硬约束)。
  assert.equal(sleeps.length, 1)
  assert.ok(sleeps[0] >= 3000, `请求间隔应 >=3000ms,实际 ${sleeps[0]}`)
  // 第二条必须带 signDayTime 与 type=1;eapi 的密文可在测试里用公开常量解开复核。
  const second = eapiPlain(form(calls[1].options.body).get('params'))
  assert.equal(second.url, '/api/vipnewcenter/app/level/user/checkin/history/detail')
  assert.equal(second.data.type, 1)
  assert.equal(typeof second.data.signDayTime, 'number')
  assert.ok(result.raw.sign && result.raw.checkin)
})

test('HTTP 200 但业务字段显示未签:businessOk=false、不重试、不算成功', async () => {
  const { calls, fetchImpl, sleep } = scripted([
    { body: fixture('vip-sign-ok.json') },
    { body: fixture('vip-fake-success.json') },
  ])
  const result = await signVip({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.businessOk, false)
  assert.equal(result.ok, false)
  assert.equal(result.step, 'checkin')
  assert.equal(result.before, true)
  assert.equal(result.after, false)
  // 读回发过,但没有第三次请求(设计文档:失败就是失败,不做接口级重试)。
  assert.equal(calls.length, 2)
})

test('第一条成功第二条失败:step=sign、businessOk=null、不算完成', async () => {
  const { calls, fetchImpl, sleep } = scripted([
    { body: fixture('vip-sign-ok.json') },
    { status: 500, body: { code: 500 } },
  ])
  const result = await signVip({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.step, 'sign')
  assert.equal(result.ok, false)
  // 读回没拿到 → 无法确认,绝不因为签到动作自称 200 就判成功。
  assert.equal(result.businessOk, null)
  assert.equal(result.after, null)
  assert.equal(calls.length, 2)
})

test('字段缺失:不抛,businessOk=null', async () => {
  const { fetchImpl, sleep } = scripted([
    { body: fixture('vip-shape-missing.json') },
    { body: fixture('vip-shape-missing.json') },
  ])
  const result = await signVip({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(result.businessOk, null)
  assert.equal(result.ok, false)
  assert.equal(result.step, 'checkin')
})

test('凭据失效:不再发读回,只发一次请求', async () => {
  const { calls, fetchImpl, sleep } = scripted([{ body: { code: 301 } }])
  const result = await signVip({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(calls.length, 1)
  assert.equal(result.step, 'sign')
  assert.equal(result.businessOk, null)
  assert.equal(result.raw.checkin, undefined)
})

test('签到请求业务失败但读回显示已签:判为已签过,ok=true', async () => {
  const { calls, fetchImpl, sleep } = scripted([
    { body: { code: 250, msg: 'SAMPLE_ALREADY_SIGNED' } },
    { body: fixture('vip-checkin-ok.json') },
  ])
  const result = await signVip({ cookie: COOKIE, deps: { fetchImpl, sleep } })
  assert.equal(calls.length, 2)
  assert.equal(result.businessOk, true)
  assert.equal(result.ok, true)
  assert.equal(result.step, 'done')
})

test('readSignState:只认明确布尔或 1/0,其余一律 null', () => {
  assert.equal(readSignState({ code: 200, data: { sign: true } }), true)
  assert.equal(readSignState({ code: 200, data: { sign: false } }), false)
  assert.equal(readSignState({ code: 200, data: { signed: 1 } }), true)
  assert.equal(readSignState({ code: 200, data: { hasSigned: 0 } }), false)
  assert.equal(readSignState({ code: 200, data: {} }), null)
  assert.equal(readSignState({ code: 200, data: { sign: 'yes' } }), null)
  assert.equal(readSignState({ code: 200 }), null)
  assert.equal(readSignState(null), null)
})

test('judgeVipSign:以读回为权威,读回缺失时不回退成 true', () => {
  assert.equal(judgeVipSign(true, true), true)
  assert.equal(judgeVipSign(true, false), false)
  assert.equal(judgeVipSign(null, true), true)
  assert.equal(judgeVipSign(true, null), null)
  assert.equal(judgeVipSign(null, null), null)
})
