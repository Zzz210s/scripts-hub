// run.js 的编排辅助:账号视图 / 跳过路由 / 投递记账 / 只读凭据体检 / 逐账号串行签到。
// 拆成独立文件是为了守住单文件 200 行上限(全局规则 A17)。
// 判定口径只有两条:凭据可不可用看只读云贝查询(由 checkOnlineGuards 决定拦不拦),
// 签到生没生效看读回(vip.businessOk)—— 都不在这里另立标准。
//
// 与贴吧实现的有意差异:贴吧的凭据体检是「取 tbs」(一次专用请求),网易云没有 tbs 这类握手,
// 直接用只读的云贝查询当体检 —— 它同时也是结果消息里云贝那一行的来源,不重复查询。
import { peerBusy } from './guards.js'
import { buildAction } from './messages.js'
import { pace } from './pacing.js'
import { classifyError } from './verify.js'
import { signVip } from './vip.js'
import { queryYunbei } from './yunbei.js'

/** 正常跳过、只写日志不推送的原因。其余守卫原因都要推一条 action(见 routeSkip)。 */
export const SILENT_SKIP = new Set(['done-today', 'peer-running', 'quiet-hours'])

/** 账号视图:消息层只需要名字与错误细节;绝不把 cookie 带进渲染。 */
export const view = (accounts) =>
  accounts.map((account) => ({
    id: account.id,
    name: account.name,
    error: account.error,
    reason: account.reason,
  }))

/** 唯一 id -> 显示名。 */
export const labelMap = (accounts) => Object.fromEntries(accounts.map((account) => [account.id, account.name]))

/**
 * 统一发送入口:把消息文本记进 messages,把投递结果记进 deliveries。没注入发送器时
 * 显式记为失败 —— 否则「没发送器」与「发送成功了」在返回值里长得一样,现场无从区分。
 */
export function makeDeliver(deps, sinks) {
  return async (text) => {
    const { messages, deliveries } = sinks
    messages.push(text)
    let delivery
    if (typeof deps?.send !== 'function') delivery = { ok: false, error: '没有注入发送器' }
    else {
      try {
        delivery = (await deps.send(text)) ?? { ok: true }
      } catch (error) {
        delivery = { ok: false, error: error?.message ?? String(error) }
      }
    }
    deliveries.push(delivery)
    return delivery
  }
}

/** 跳过消息路由:静默集合只写日志,其余渲染成一条需要你处理的 action。 */
export function routeSkip({ reason, date, accounts }) {
  if (SILENT_SKIP.has(reason)) return { silent: true, messages: [] }
  return { silent: false, messages: [buildAction({ date, accounts, reason })] }
}

/** 发送失败不能静默:逐条写进日志,让没有通知渠道时也能在日志里看到。 */
export function warnFailedDeliveries(log, deliveries) {
  for (const delivery of deliveries) {
    if (delivery?.ok === false) log(`[警告] 消息发送失败 · ${delivery.error ?? '未知原因'}`)
  }
}

/** 最后一条投递结果(结果消息);没有投递时给 null。 */
export const lastDelivery = (deliveries) => deliveries[deliveries.length - 1] ?? null

/** 同伴判定:测试可整体注入;否则走 peerBusy 的「读锁 + 调 lock-status」口径。 */
export function peerOf(deps, config, now) {
  if (typeof deps.peerRunning === 'function') {
    const value = deps.peerRunning()
    if (typeof value === 'boolean') return { busy: value, detail: '' }
    return value ?? { busy: false, detail: '' }
  }
  return peerBusy(config.busyPeers, { exec: deps.exec, nowMs: now.getTime() })
}

/** 一次请求失败的分类:只认 client 给出的 reason / code,分类矩阵在 verify.js。 */
export function kindOfVip(vip) {
  if (!vip) return null
  const raw = vip.raw?.sign ?? vip.raw?.checkin
  if (!raw || raw.ok === true) return null
  return classifyError({ reason: raw.reason, code: raw.code, error: raw.error })
}

/**
 * 全部账号不可用时给出诚实的跳过原因:全网络失败就报 network、全限流就报 rate-limit、
 * 全结构异常就报 shape,其余(含认不全的混合失败)按守卫的 credentials-invalid。
 */
export function onlineSkipReason(online, credentials) {
  if (credentials.length === 0) return online.reason
  const kinds = new Set(credentials.map((item) => classifyError({ reason: item.reason, error: item.error })))
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
 */
export async function probeAll(accounts, deps) {
  const credentials = []
  for (const [index, account] of accounts.entries()) {
    if (index > 0) await pace(deps)
    const yunbei = await queryYunbei({ cookie: account.cookie, deps })
    const signed = yunbei.raw?.signed ?? null
    credentials.push({
      id: account.id,
      name: account.name,
      ok: yunbei.ok === true,
      error: signed?.error ?? null,
      reason: signed?.reason ?? null,
      kind: yunbei.ok === true ? null : classifyError({ reason: signed?.reason, error: signed?.error }),
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

/** 整体成功口径:至少一个可用账号,且每个账号的读回都确认已签。 */
export const overallOk = (outcomes) =>
  outcomes.length > 0 && outcomes.every((outcome) => outcome.ok === true && outcome.vip?.businessOk === true)

/** 历史里只存渲染与排查需要的字段,不把整份原始响应写进去。 */
export const trimAccounts = (outcomes) =>
  outcomes.map(({ id, name, ok, error, reason, vip, yunbei }) => ({
    id,
    name,
    ok,
    error,
    reason,
    vip: vip ? { ok: vip.ok, step: vip.step, businessOk: vip.businessOk } : null,
    yunbei: yunbei ? { ok: yunbei.ok, balance: yunbei.balance, signedToday: yunbei.signedToday } : null,
  }))
