// T5:云贝只读查询(设计文档范围 A2 —— 只查询,不做云贝签到)。
// 两条 weapi 查询都只要 cookie:
//   1. /weapi/point/signed/get   —— 签到状态(权威段)
//   2. /weapi/point/today/get    —— 今日信息,必要时补余额
// 只读、不写、不重试、不猜:字段读不到就如实返回 null,渲染成「未知」而不是编一个数。
// 路径只从 crypto.js 的 PATHS 取;待 T3 探针校正的字段见报告与 NOTICE。
import { call } from './client.js'
import { PATHS } from './crypto.js'
import { pace } from './pacing.js'

// 候选字段名来自调研文档对 api-enhanced 的读取(module/yunbei.js、yunbei_today.js、
// yunbei_info.js),尚未带凭据实测 —— T3 探针跑通后收敛成实测字段。
const SIGN_FIELDS = ['sign', 'signed', 'signedToday', 'todaySigned', 'hasSigned']
const BALANCE_FIELDS = ['yunbeiNum', 'balance', 'point', 'yunbei', 'total', 'amount', 'accountBalance']

const dataOf = (payload) => {
  const data = payload && typeof payload === 'object' ? payload.data : null
  return data && typeof data === 'object' ? data : null
}

/** 纯函数:读「今日是否已签」。只认明确布尔或 1/0,缺失返回 null。 */
export function readSigned(payload) {
  const data = dataOf(payload)
  if (!data) return null
  for (const field of SIGN_FIELDS) {
    const value = data[field]
    if (typeof value === 'boolean') return value
    if (value === 1) return true
    if (value === 0) return false
  }
  return null
}

/** 纯函数:读云贝余额。只认有限数字或数字字符串,其余返回 null。 */
export function readBalance(payload) {
  const data = dataOf(payload)
  if (!data) return null
  for (const field of BALANCE_FIELDS) {
    const value = data[field]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

/**
 * 查询云贝状态。返回 { ok, balance, signedToday, raw },永不抛。
 * 第一段(签到状态)失败即 ok:false —— 渲染成「暂不可用」,不崩、不谎报;
 * 第二段只补余额,失败不影响 ok,缺的字段如实为 null。
 */
export async function queryYunbei({ cookie, deps } = {}) {
  const signed = await call({ url: PATHS.yunbeiSignedGet, crypto: 'weapi', data: {}, cookie, deps })
  if (!signed.ok) {
    return { ok: false, balance: null, signedToday: null, raw: { signed } }
  }
  await pace(deps)
  const today = await call({ url: PATHS.yunbeiTodayGet, crypto: 'weapi', data: {}, cookie, deps })
  const balance = readBalance(signed.body) ?? (today.ok ? readBalance(today.body) : null)
  return { ok: true, balance, signedToday: readSigned(signed.body), raw: { signed, today } }
}

/**
 * 纯函数:把查询结果渲染成一行,供企业微信 result 消息复用。
 * 成功:`云贝:余额 X · 今日已签/未签`;字段缺失用「未知」;失败:`云贝:暂不可用`。
 */
export function renderYunbeiLine(yunbei) {
  if (!yunbei || yunbei.ok !== true) return '云贝:暂不可用'
  const head = typeof yunbei.balance === 'number' ? `云贝:余额 ${yunbei.balance}` : '云贝:余额未知'
  const status =
    yunbei.signedToday === true ? '今日已签' : yunbei.signedToday === false ? '今日未签' : '签到状态未知'
  return `${head} · ${status}`
}
