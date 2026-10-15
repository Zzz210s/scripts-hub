// 命令行入口。只做参数解析、I/O 组装与只读子命令;编排在 run.js,判定在 vip.js / yunbei.js。
//
//   node src/cli.js run [--dry]    完整跑一次;--dry 只预览会推送什么,不发送不落盘
//   node src/cli.js check          只读体检:每个账号的 VIP 乐签状态与云贝余额
//   node src/cli.js probe          只读探针入口:VIP 状态读回与云贝查询,绝不调用签到接口
//   node src/cli.js report [--dry] 把当天结果汇总出来;--dry 只打印
//
// check 与 probe 都不写状态、不发送;probe 是 T3 用真凭据实测的入口,只读是它的硬约束。
// 退出码:守卫跳过与正常跳过都是 0,真失败才是 1。
import fs from 'node:fs'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

import { call } from './client.js'
import { dateText, logicalDay } from './clock.js'
import { loadConfig } from './config.js'
import { PATHS } from './crypto.js'
import { buildResult } from './messages.js'
import { pace } from './pacing.js'
import { runOnce } from './run.js'
import { attemptsOn, doneToday, historyFile, readState } from './state.js'
import { readAccounts, vipWord } from './probe.js'
import { queryYunbei, renderYunbeiLine } from './yunbei.js'

const USAGE = `用法:node src/cli.js <命令> [--dry]

  run [--dry]    完整跑一次;--dry 只预览会推送什么,不发送不落盘
  check          只读体检:每个账号的 VIP 乐签状态与云贝余额
  probe          只读探针:VIP 状态读回与云贝查询,绝不调用签到接口
  report [--dry] 把当天的运行结果汇总出来;--dry 只打印
  help           显示本帮助`

/** 可用内存:优先 /proc/meminfo,非 Linux 回落到系统空闲内存。 */
function freeMemoryMb() {
  try {
    const matched = /^MemAvailable:\s+(\d+) kB/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'))
    if (matched) return Math.round(Number(matched[1]) / 1024)
  } catch {
    /* /proc 不在,走兜底 */
  }
  return Math.round(os.freemem() / 1048576)
}

/** 企业微信发送走延迟 import:Task 10 才落地 notify.js,注入 send 时这里永不执行。 */
async function sendViaWecom(text, config, deps) {
  const { sendWecom } = await import('./notify.js')
  return sendWecom(text, { webhookFile: config.webhookFile, fetchImpl: deps.fetchImpl, sleep: deps.sleep })
}

/** 历史文件里当天最后一条记录;没有就返回 null。坏行跳过,不让一行脏数据废掉报告。 */
function lastEntryForDay(day, dir, fsImpl = fs) {
  const file = historyFile(dir)
  if (!fsImpl.existsSync(file)) return null
  const rows = fsImpl.readFileSync(file, 'utf8').split('\n').filter((row) => row.trim())
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(rows[index])
      if (entry.day === day) return entry
    } catch {
      /* 坏行跳过 */
    }
  }
  return null
}

/** check:只读,不写状态不发送。任何账号读不到就给 1,便于部署侧巡检。 */
async function runCheck({ config, deps, now, log }) {
  log(`网易云音乐签到 · 只读体检 · ${dateText(now)}`)
  if (config.accounts.length === 0) {
    log('没有配置任何账号 · 请把 ACCOUNT_1_MUSIC_U 写进 .env')
    return 1
  }
  const allOk = await readAccounts({ config, deps, log, verbose: false })
  const day = logicalDay(now, config.boundaryHour)
  const { state } = readState(config.stateDir, { fsImpl: deps.fsImpl })
  log(`当天状态 · ${doneToday(state, day) ? '已完成' : '未完成'} · 尝试 ${attemptsOn(state, day)}/${config.maxAttempts}`)
  return allOk ? 0 : 1
}

/** probe:只读探针入口。只有查询,没有签到调用,也不落状态。 */
async function runProbe({ config, deps, now, log }) {
  log(`网易云音乐签到 · 只读探针 · ${dateText(now)}`)
  if (config.accounts.length === 0) {
    log('没有配置任何账号 · 请把 ACCOUNT_1_MUSIC_U 写进 .env')
    return 1
  }
  const allOk = await readAccounts({ config, deps, log, verbose: true })
  log(allOk ? '[探针] 只读链路全部可用 · 未发送任何签到请求' : '[探针] 有接口未通过 · 详见上面逐接口结果')
  return allOk ? 0 : 1
}

/** report:把当天最后一条运行记录按 result 模板重渲染;--dry 只打印。 */
async function runReport({ config, deps, now, dry, log }) {
  const day = logicalDay(now, config.boundaryHour)
  const entry = lastEntryForDay(day, config.stateDir, deps.fsImpl)
  if (!entry) {
    log(`当天还没有运行记录 · ${day}`)
    return 0
  }
  const text = buildResult({
    date: entry.date ?? dateText(now),
    accounts: entry.accounts ?? [],
    exitCode: entry.exitCode ?? 0,
    dryRun: false,
  })
  if (dry) {
    log(text)
    return 0
  }
  let sent
  try {
    sent = await deps.send(text)
  } catch (error) {
    sent = { ok: false, error: error?.message ?? String(error) }
  }
  if (sent?.ok === false) {
    // errcode 是「需要人工处理」与限流的唯一信号,最后一环不能丢。
    const code = sent.errcode === undefined ? '' : ` · errcode ${sent.errcode}`
    log(`[通知] 企业微信发送失败 · ${sent.error}${code}`)
  } else {
    log('[通知] 企业微信已发送')
  }
  return 0
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('-')))
  const command = argv.find((arg) => !arg.startsWith('-')) ?? 'run'
  const log = options.log ?? ((line) => process.stdout.write(`${line}\n`))
  const err = options.error ?? ((line) => process.stderr.write(`${line}\n`))
  const injected = options.deps ?? {}
  const now = options.now ?? new Date()
  const cwd = options.cwd ?? process.cwd()
  const flagDry = flags.has('--dry') || flags.has('--dry-run')

  if (flags.has('-h') || flags.has('--help') || command === 'help') {
    log(USAGE)
    return 0
  }

  const config = injected.config ?? loadConfig(cwd, { env: options.env ?? process.env, fsImpl: injected.fsImpl })
  // 环境变量里的 NETEASE_DRY_RUN=1 与 --dry 同权:安全开关不能被 report 忽略。
  const dry = flagDry || config.dryRun === true
  const deps = {
    ...injected,
    config,
    log,
    freeMb: injected.freeMb ?? freeMemoryMb,
    send: injected.send ?? ((text) => sendViaWecom(text, config, injected)),
  }
  // 只读子命令单次尝试、不重试;runOnce 内部另有一套默认(网络异常退避重试一次)。
  const readDeps = { ...deps, retries: 0, timeoutMs: deps.timeoutMs ?? config.timeoutMs }

  if (command === 'run') return (await runOnce({ cwd, now, dryRun: dry, deps })).exitCode
  if (command === 'check') return runCheck({ config, deps: readDeps, now, log })
  if (command === 'probe') return runProbe({ config, deps: readDeps, now, log })
  if (command === 'report') return runReport({ config, deps, now, dry, log })
  err(USAGE)
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      process.stderr.write(`[错误] ${error?.message ?? error}\n`)
      process.exitCode = 1
    })
}

export { freeMemoryMb, lastEntryForDay }
