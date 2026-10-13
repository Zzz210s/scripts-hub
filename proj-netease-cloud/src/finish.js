// T9 编排的收尾段:成长基线 -> 结果消息 -> 落状态与历史 -> 返回值。
// 从 run.js 拆出来只为守住单文件 200 行上限(全局规则 A17);判定口径不在这里另立标准 ——
// 「这次到底算不算成功」由 run-support.js 的 overallOk 决定,这里只负责按结论落盘与渲染。
import { buildResult } from './messages.js'
import { lastDelivery, overallOk, trimAccounts, warnFailedDeliveries } from './run-support.js'
import { appendHistory, markDayDone, writeState } from './state.js'
import { day0Baseline } from './verify.js'

/** 只认有限数字;缺失 / 空串 / NaN 一律当「没取到」,不编 0。 */
const numOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 第一个非 ok 的原因码,写进历史;找不到就给 null,由调用方兜底成 unconfirmed。 */
const failedReason = (outcomes) => outcomes.find((one) => one.reason && one.reason !== 'ok')?.reason ?? null

/**
 * 收尾。deliver 是 run.js 的投递入口,状态写入走 state.js 的原子写。
 * 返回形状与 runOnce 的成功分支一致,run.js 直接原样返回。
 */
export async function finishRun({ config, state, outcomes, date, day, now, deliver, log, deliveries, messages, deps }) {
  // 成长基线:首次运行采一次,之后只用「相对基线变化」,没有基线就不写这一行。
  const previous = state.baseline
  const balance = numOrNull(outcomes.find((one) => one.yunbei?.ok === true)?.yunbei?.balance)
  if (!state.baseline) state.baseline = day0Baseline(state, { yunbei: balance, growthPoint: null })

  const ok = overallOk(outcomes)
  const exitCode = ok ? 0 : 1
  await deliver(buildResult({ date, accounts: outcomes, baseline: previous, exitCode, ok }))
  const reason = ok ? 'ok' : failedReason(outcomes) ?? 'unconfirmed'
  // 只有全部账号读回确认才把当天记为完成;失败尝试在开跑前就记下了,这里不重复计数。
  if (ok) markDayDone(state, { day, now })
  writeState(state, config.stateDir, now, { fsImpl: deps.fsImpl })
  appendHistory({ day, date, ok, reason, exitCode, accounts: trimAccounts(outcomes) }, config.stateDir, {
    now,
    fsImpl: deps.fsImpl,
  })
  log(`[完成] ${ok ? '运行成功' : '运行有失败'}`)
  warnFailedDeliveries(log, deliveries)
  const first = outcomes[0] ?? {}
  return {
    skipped: false,
    ok,
    dryRun: false,
    vip: first.vip ?? null,
    yunbei: first.yunbei ?? null,
    accounts: outcomes,
    exitCode,
    reason,
    messages,
    deliveries,
    lastDelivery: lastDelivery(deliveries),
  }
}
