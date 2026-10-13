// run.js 的编排辅助:账号视图 / 跳过路由 / 投递记账 / 整体汇总。
// 逐账号的凭据体检与串行签到在 run-accounts.js —— 这里只留与请求无关的编排与渲染辅助。
// 拆成独立文件是为了守住单文件 200 行上限(全局规则 A17)。
// 判定口径只有两条:凭据可不可用看只读云贝查询(由 checkOnlineGuards 决定拦不拦),
// 签到生没生效看读回(vip.businessOk)—— 都不在这里另立标准。
import { peerBusy } from './guards.js'
import { buildAction } from './messages.js'

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
