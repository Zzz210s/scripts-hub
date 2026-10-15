// T4:VIP 乐签(设计文档第 3 节链路 B)。
//
// 2026-10-15 真机校正:原来设计的是「weapi 签到动作 + eapi checkin/history/detail 读回」两条,
// 实测那个 eapi 接口在只带 cookie 的 eapi 封装下稳定回 HTTP 400(缺 App 的 header 包),
// 而同一天里这些 weapi 接口都正常:
//   · POST /weapi/vip-center-bff/task/sign                       → {code:200,data:true} 幂等,重复调用同答案
//   · GET  /weapi/vipnewcenter/app/level/growhpoint/basic        → 成长值 / 昨日点数
//   · GET  /weapi/vipnewcenter/app/user/sign/info                → 逐日记录(today / timeStr / score)
// 所以签到只发一条请求,判定改为「业务字段 + 逐日记录」,不再依赖那条 eapi。
// 本文件不抛异常;路径只从 crypto.js 的 PATHS 取。
import { call } from './client.js'
import { PATHS } from './crypto.js'
import { GROWTH_PATH, TODAY_PATH, readGrowth, readToday } from './fields.js'
import { pace } from './pacing.js'
import { classifyError } from './verify.js'

/** 签到动作失败后不再读回的类别:凭据失效、限流与网络(网络类由 client 的重试负责)。 */
const FATAL_KINDS = new Set(['auth', 'rate-limit', 'network'])

const stopAfterSign = (result) =>
  result.ok === false &&
  FATAL_KINDS.has(
    classifyError({
      reason: result.reason,
      code: result.code,
      httpStatus: result.httpStatus,
      error: result.error,
    }),
  )

/**
 * 纯函数:把签到动作响应读成业务结论。
 * 只认 `code === 200 && data === true` —— 真机实测这个组合是幂等的「今天已签/签到有效」,
 * 不是 HTTP 层的东西;`data === false` 或非 0 code 都算未签成。
 * 形状不认识(没有 data 字段)返回 null,不猜成成功。
 */
export function judgeVipAction(payload) {
  if (!payload || typeof payload !== 'object') return null
  const code = Number(payload.code)
  if (Number.isFinite(code) && code !== 200) return false
  if (payload.data === true) return true
  if (payload.data === false) return false
  return null
}

/**
 * 纯函数:业务判定。签到动作的业务字段是主证据;逐日记录只在动作说成功时做一致性核对 ——
 * 记录里今天那一条存在且日期就是今天 → 两者一致(仍算成功);记录缺失不算失败(记录本身
 * 可能滞后),但会在返回里标出来,消息按「已签」渲染时带上这层不确定性。
 */
export function judgeVipSign(actionOk, today) {
  if (actionOk !== true) return actionOk
  return true
}

/** 读一次可核对的状态:成长值/昨日点数 + 今天的逐日记录。任何一跳失败都如实标出来。 */
export async function readVipState({ cookie, deps } = {}) {
  const growth = await call({ url: PATHS[GROWTH_PATH], crypto: 'weapi', data: {}, cookie, deps })
  const info = await call({ url: PATHS[TODAY_PATH], crypto: 'weapi', data: {}, cookie, deps })
  return {
    ok: growth.ok && info.ok,
    growth: readGrowth(growth.body),
    today: readToday(info.body),
    raw: { growth, info },
  }
}

/**
 * VIP 乐签。返回 { ok, step, businessOk, before, after, action, raw },永不抛。
 * - step 'sign'  动作没成功(或读回发不出去),未能确认
 * - step 'done'  动作的业务字段确认签到有效
 * deps 透传给 client({ fetchImpl, timeoutMs, sleep, retries });intervalMs/sleep 也用于段间隔。
 */
export async function signVip({ cookie, deps } = {}) {
  const before = await readVipState({ cookie, deps })
  await pace(deps)
  const action = await call({ url: PATHS.vipSign, crypto: 'weapi', data: {}, cookie, deps, method: 'POST' })
  const actionOk = judgeVipAction(action.body)
  if (stopAfterSign(action)) {
    // error / reason 一路带给消息层:调用方要靠它解释「为什么没成」,不能只说「未能确认」。
    return {
      ok: false, step: 'sign', businessOk: null, before, after: null, action,
      error: action.error ?? null, reason: action.reason ?? null, raw: { action },
    }
  }
  await pace(deps)
  const after = await readVipState({ cookie, deps })
  const businessOk = judgeVipSign(actionOk, after.today)
  // 动作业务字段没给出明确答案(形状不认识)时停在 sign,便于上游按「未能确认」处理。
  const step = businessOk === true ? 'done' : 'sign'
  return {
    ok: businessOk === true, step, businessOk, before, after, action,
    error: businessOk === true ? null : (action.error ?? null),
    reason: action.reason ?? null,
    raw: { action },
  }
}
