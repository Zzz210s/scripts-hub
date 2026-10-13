// T4:VIP 乐签(设计文档第 3 节链路 B)。两条请求缺一不打卡:
//   1. weapi POST /weapi/vip-center-bff/task/sign
//   2. eapi  POST /eapi/vipnewcenter/app/level/user/checkin/history/detail  必发
// 设计硬约束:只做读与签到;单账号串行、间隔 >=3 秒;签到结果以「读回」为准,
// 不信 HTTP 200 / code 200(api-enhanced #197 的假成功先例)。本文件不抛异常。
// 路径只从 crypto.js 的 PATHS 取,不在这里另写一份。
import { call } from './client.js'
import { PATHS } from './crypto.js'
import { pace } from './pacing.js'

// 读回判定的候选字段路径。名字来自调研文档对 api-enhanced 的读取(data.sign,见 issue #197/#234),
// 尚未带凭据实测 —— T3 探针跑通后收敛成实测字段,并同步 vip-checkin-ok.json 夹具。
const SIGN_FIELDS = ['sign', 'signed', 'signedToday', 'todaySigned', 'hasSigned']

/**
 * 纯函数:从一条响应体里读「是否已签」。只认明确布尔或 1/0;
 * 缺失、非布尔、非对象一律 null —— 不猜、不抛(形状变了不算已签)。
 */
export function readSignState(payload) {
  const data = payload && typeof payload === 'object' ? payload.data : null
  if (!data || typeof data !== 'object') return null
  for (const field of SIGN_FIELDS) {
    const value = data[field]
    if (typeof value === 'boolean') return value
    if (value === 1) return true
    if (value === 0) return false
  }
  return null
}

/**
 * 纯函数:业务判定。读回(第二个响应)是唯一权威 —— 只有它说已签才算数;
 * 签到动作自称的 200/true 不作证据,读回缺失就返回 null(未能确认),绝不回退成 true。
 */
export function judgeVipSign(before, after) {
  return typeof after === 'boolean' ? after : null
}

/** 再读回也没有意义的失败类别:凭据类与网络类(网络类由 client 的重试负责)。 */
const FATAL_REASONS = new Set(['auth', 'no-cookie', 'network'])

/**
 * VIP 乐签。返回 { ok, step, businessOk, before, after, raw },永不抛。
 * - step 'sign'    停在签到动作(读回没发或失败,未能确认)
 * - step 'checkin' 两段都发完,但业务未确认为已签
 * - step 'done'    两段都成功且读回确认已签
 * - ok 等价于 businessOk === true
 * deps 透传给 client({ fetchImpl, timeoutMs, sleep, retries });intervalMs/sleep 也用于段间隔。
 */
export async function signVip({ cookie, deps } = {}) {
  const sign = await call({ url: PATHS.vipSign, crypto: 'weapi', data: {}, cookie, deps })
  const before = readSignState(sign.body)
  if (!sign.ok && FATAL_REASONS.has(sign.reason)) {
    return { ok: false, step: 'sign', businessOk: null, before, after: null, raw: { sign } }
  }
  await pace(deps)
  const checkin = await call({
    url: PATHS.vipCheckinDetail,
    crypto: 'eapi',
    data: { signDayTime: Date.now(), type: 1 },
    cookie,
    deps,
  })
  const after = readSignState(checkin.body)
  const businessOk = judgeVipSign(before, after)
  const step = checkin.ok ? (businessOk === true ? 'done' : 'checkin') : 'sign'
  return { ok: businessOk === true, step, businessOk, before, after, raw: { sign, checkin } }
}
