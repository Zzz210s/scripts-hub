// 逐账号段:账号级失败分类 / 只读凭据体检 / 串行签到。
// 从 run-support.js 拆出来,与它一样是为了守住单文件 200 行上限(全局规则 A17)。
// 判定口径只有两条:凭据可不可用看只读云贝查询(由 checkOnlineGuards 决定拦不拦),
// 签到生没生效看读回(vip.businessOk)—— 都不在这里另立标准。
//
// 与贴吧实现的有意差异:贴吧的凭据体检是「取 tbs」(一次专用请求),网易云没有 tbs 这类握手,
// 直接用只读的云贝查询当体检 —— 它同时也是结果消息里云贝那一行的来源,不重复查询。
import { pace } from './pacing.js'
import { classifyError } from './verify.js'
import { signVip } from './vip.js'
import { queryYunbei } from './yunbei.js'

/** 一次请求失败的分类:只认 client 给出的 reason / code / httpStatus,矩阵在 verify.js。 */
export function kindOfVip(vip) {
  if (!vip) return null
  // 2026-10-15 起签到只有一条动作请求(见 src/vip.js):失败分类看它;形状不认识
  // (businessOk === null 但没有传输失败)不算熔断类,交给正常的失败路径。
  const raw = vip.raw?.action
  if (!raw || raw.ok === true) return null
  return classifyError({ reason: raw.reason, code: raw.code, httpStatus: raw.httpStatus, error: raw.error })
}

/**
 * 全部账号不可用时给出诚实的跳过原因:全网络失败就报 network、全限流就报 rate-limit、
 * 全结构异常就报 shape,其余(含认不全的混合失败)按守卫的 credentials-invalid。
 */
export function onlineSkipReason(online, credentials) {
  if (credentials.length === 0) return online.reason
  const kinds = new Set(
    credentials.map((item) =>
      classifyError({ reason: item.reason, code: item.code, httpStatus: item.httpStatus, error: item.error }),
    ),
  )
  if (kinds.size === 1) {
    const only = [...kinds][0]
    if (only === 'network' || only === 'rate-limit' || only === 'shape') return only
  }
  return online.reason
}

/** 账号级失败的记账形状:vip 为 null,渲染成「未能确认」并带上原因。 */
export const failedOutcome = (account, error, reason) => ({
  id: account.id,
  name: account.name,
  ok: false,
  vip: null,
  yunbei: null,
  error: error ?? null,
  reason: reason ?? 'failed',
})

/**
 * 逐账号只读凭据体检:云贝查询既当体检,也复用为结果里的云贝一行。
 * 账号之间补一次 3 秒间隔(硬约束:串行、间隔 >=3 秒)。
 * code 与 httpStatus 一并带出,否则限流在汇总时会掉进 shape 而不是 rate-limit ——
 * 网易 weapi 最常见的限流形状正是 HTTP 200 + body code 429,只带 httpStatus 抓不到它。
 */
export async function probeAll(accounts, deps) {
  const credentials = []
  for (const [index, account] of accounts.entries()) {
    if (index > 0) await pace(deps)
    const yunbei = await queryYunbei({ cookie: account.cookie, deps })
    const signed = yunbei.raw?.signed ?? null
    const signal = {
      reason: signed?.reason,
      code: signed?.code,
      httpStatus: signed?.httpStatus,
      error: signed?.error,
    }
    credentials.push({
      id: account.id,
      name: account.name,
      ok: yunbei.ok === true,
      error: signed?.error ?? null,
      reason: signed?.reason ?? null,
      code: signed?.code ?? null,
      httpStatus: signed?.httpStatus ?? null,
      kind: yunbei.ok === true ? null : classifyError(signal),
      yunbei,
    })
  }
  return credentials
}

/** 读回未确认时的一句话原因:优先上游错误原文,其次机器码,都没有就留空。 */
const signError = (vip) => {
  const checkin = vip?.raw?.checkin
  const sign = vip?.raw?.sign
  if (checkin && checkin.ok === false) return checkin.error ?? null
  if (sign && sign.ok === false) return sign.error ?? null
  return null
}

/**
 * 逐账号串行签到:只对凭据可用的账号发请求;凭据失效的账号不重试、如实记账。
 * 每个账号开跑前补一次 3 秒间隔(含与体检段之间的间隔)。
 */
export async function signAll({ accounts, credentials, deps }) {
  const outcomes = []
  for (const account of accounts) {
    const credential = credentials.find((item) => item.id === account.id)
    if (credential?.ok !== true) {
      outcomes.push({
        ...failedOutcome(account, credential?.error, credential?.reason),
        kind: credential?.kind ?? null,
        yunbei: credential?.yunbei ?? null,
      })
      continue
    }
    await pace(deps)
    const vip = await signVip({ cookie: account.cookie, deps })
    const kind = vip.businessOk === true ? null : kindOfVip(vip)
    const failure = kind === null ? null : signError(vip)
    outcomes.push({
      id: account.id,
      name: account.name,
      ok: vip.ok === true,
      vip,
      yunbei: credential.yunbei,
      error: failure,
      reason: failure ? kind ?? 'failed' : null,
      kind,
    })
  }
  return outcomes
}
