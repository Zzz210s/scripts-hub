// Task 9 编排:本地守卫 -> 单实例锁 -> 只读凭据体检 -> 逐账号签到 -> 读回判定 -> 落盘 -> 通知。
// 「今天到底签没签上」的唯一权威是 VIP 乐签的读回(vip.businessOk),不信 HTTP 200;
// 网络、时钟、发送、内存、同伴、锁全部从 deps 注入,可离线集成测试。
// 凭据失效当天熔断(state 的 circuitBroken),同一天不再请求;不做登录。
import { dateText, logicalDay } from './clock.js'
import { loadConfig } from './config.js'
import { finishRun } from './finish.js'
import { checkLocalGuards, checkOnlineGuards } from './guards.js'
import { acquireLock, releaseLock } from './lock.js'
import { buildResult, buildSkip, buildStart } from './messages.js'
import { kindOfVip, onlineSkipReason, probeAll, signAll } from './run-accounts.js'
import { makeDeliver, peerOf, routeSkip, view, warnFailedDeliveries } from './run-support.js'
import {
  attemptsOn,
  breakCircuit,
  doneToday,
  isCircuitBroken,
  readState,
  recordAttempts,
  writeState,
} from './state.js'

/**
 * 跑一次完整流程。deps 全部可注入,便于离线集成测试。
 * - freeMb: () => number,返回可用内存 MB。**不注入时低内存守卫整段跳过并记一条日志** ——
 *   不是「内存充足」,是「测不到」;不把它当 Infinity 静默放行。
 * - fetchImpl / send / sleep / peerRunning / acquireLock / releaseLock / config 等见调用点。
 */
export async function runOnce({ cwd = process.cwd(), now = new Date(), dryRun = false, deps = {} } = {}) {
  const log = deps.log ?? (() => {})
  const config = deps.config ?? loadConfig(cwd, { env: deps.env, fsImpl: deps.fsImpl })
  const dry = dryRun === true || config.dryRun === true
  const date = dateText(now)
  const day = logicalDay(now, config.boundaryHour)
  const accounts = Array.isArray(config.accounts) ? config.accounts : []
  const { state, warnings } = readState(config.stateDir, { fsImpl: deps.fsImpl })
  for (const warning of warnings) log(`[警告] ${warning}`)

  const messages = []
  const deliveries = []
  // 重试只留给网络异常且仅一次(处理矩阵);退避与「间隔 >=3 秒」对齐,不短于下限。
  const runDeps = {
    ...deps,
    retries: deps.retries ?? 1,
    retryDelayMs: deps.retryDelayMs ?? config.requestIntervalMs,
    intervalMs: deps.intervalMs ?? config.requestIntervalMs,
    timeoutMs: deps.timeoutMs ?? config.timeoutMs,
  }
  const deliver = makeDeliver(runDeps, { messages, deliveries })

  /** 跳过统一出口:静默原因只写日志,其余推一条 action;--dry 只打印不发送、不落盘。 */
  const skip = async (reason, detail = '', forMessage = view(accounts)) => {
    const routed = routeSkip({ reason, date, accounts: forMessage })
    if (routed.silent) {
      log(buildSkip({ date, accounts: forMessage, reason }))
    } else {
      log(`[跳过] ${reason}${detail ? ` · ${detail}` : ''}`)
      for (const text of routed.messages) {
        if (dry) log(text)
        else await deliver(text)
      }
    }
    warnFailedDeliveries(log, deliveries)
    return {
      skipped: true,
      ok: false,
      dryRun: dry,
      vip: null,
      yunbei: null,
      accounts: [],
      exitCode: 0,
      reason,
      detail,
      messages: routed.messages,
      deliveries,
    }
  }

  // 1. 本地守卫:不联网、秒级返回。dry 也走这一段,因为它决定会推送什么。
  const peer = peerOf(runDeps, config, now)
  // 内存探测没注入就显式跳过该守卫并记一条日志,不让「没注入」看起来像「内存充足」。
  const freeMb = typeof deps.freeMb === 'function' ? deps.freeMb() : null
  if (freeMb === null) log('[警告] 未注入内存探测,低内存守卫已跳过')
  const local = checkLocalGuards({
    now,
    paused: state.paused === true,
    doneToday: doneToday(state, day),
    circuitBroken: isCircuitBroken(state, day),
    attempts: attemptsOn(state, day),
    maxAttempts: config.maxAttempts,
    peerRunning: peer.busy === true,
    peerDetail: peer.detail ?? '',
    freeMb: freeMb ?? Infinity,
    limits: {
      quietStart: config.quietStart,
      quietEnd: config.quietEnd,
      shutdownTime: config.shutdownTime,
      shutdownMarginMinutes: config.shutdownMarginMinutes,
      minFreeMb: config.minFreeMb,
    },
  })
  if (local.action === 'skip') return skip(local.reason, local.detail)

  // 2. dry:只规划与预览 —— 不加锁、不联网、不发送、不写状态、不消耗当天尝试次数。
  if (dry) {
    const planned = [
      buildStart({ date, accounts: view(accounts) }),
      buildResult({ date, accounts: view(accounts), dryRun: true, exitCode: 0 }),
    ]
    for (const text of planned) log(text)
    return {
      skipped: false,
      ok: false,
      dryRun: true,
      vip: null,
      yunbei: null,
      accounts: [],
      exitCode: 0,
      reason: 'dry-run',
      messages: planned,
      deliveries: [],
    }
  }

  // 3. 单实例锁(宿主 run.sh 另有 flock,两层互补)。
  const acquire = deps.acquireLock ?? acquireLock
  const lock = acquire(config.lockDir, { now })
  if (!lock.ok) return skip('peer-running', '已有一次运行在跑')

  try {
    // 4. 只读凭据体检:云贝查询既当体检,也是结果里云贝那一行的来源。单账号失效不拦整轮。
    const credentials = await probeAll(accounts, runDeps)
    const online = checkOnlineGuards({ credentials })
    if (online.action === 'skip') {
      const reason = onlineSkipReason(online, credentials)
      if (reason === 'credentials-invalid' || reason === 'rate-limit') {
        breakCircuit(state, { day, kind: reason === 'rate-limit' ? 'rate-limit' : 'auth', now })
        writeState(state, config.stateDir, now, { fsImpl: deps.fsImpl })
      }
      return await skip(reason, online.detail, credentials)
    }

    // 5. 开跑前先记一次尝试并落盘:进程被 kill、发送抛错都不至于让这次定时触发白来。
    recordAttempts(state, { day, ok: false, now })
    writeState(state, config.stateDir, now, { fsImpl: deps.fsImpl })
    await deliver(buildStart({ date, accounts: view(accounts) }))

    // 6. 逐账号串行签到;签完读回判定,凭据失效的账号直接记账、不重试。
    const outcomes = await signAll({ accounts, credentials, deps: runDeps })

    // 7. 鉴权 / 限流失败当天熔断:同一天不再请求,跨天自然失效。
    for (const outcome of outcomes) {
      const kind = kindOfVip(outcome.vip)
      if (kind === 'auth' || kind === 'rate-limit') breakCircuit(state, { day, kind, now })
    }

    // 8. 收尾:成长基线、结果消息、落状态与历史、返回值(见 finish.js)。
    return await finishRun({ config, state, outcomes, date, day, now, deliver, log, deliveries, messages, deps })
  } finally {
    const release = deps.releaseLock ?? releaseLock
    try {
      release(config.lockDir)
    } catch {
      /* 解锁失败不覆盖真实结论 */
    }
  }
}
