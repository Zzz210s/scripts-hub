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
import { loginWithCookie } from './login.js'
import { runCheck, runProbe, runReport } from './commands.js'
import { runOnce } from './run.js'
import { attemptsOn, doneToday, historyFile, readState } from './state.js'
import { readAccounts, vipWord } from './probe.js'
import { queryYunbei, renderYunbeiLine } from './yunbei.js'

const USAGE = `用法:node src/cli.js <命令> [--dry]

  run [--dry]    完整跑一次;--dry 只预览会推送什么,不发送不落盘
  check          只读体检:每个账号的 VIP 乐签状态与云贝余额
  probe          只读探针:VIP 状态读回与云贝查询,绝不调用签到接口
  report [--dry] 把当天的运行结果汇总出来;--dry 只打印
  login --file <路径> | --cookie <内容>
                 换新的 MUSIC_U:写进 .env、清当天的熔断标记,再用只读接口自证
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
  if (command === 'login') return runLogin({ cwd, now, deps: readDeps, argv, log, err })
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

export { freeMemoryMb }
export { lastEntryForDay } from './commands.js'

/**
 * login 子命令:从 --file 或 --cookie 取内容,交给 login.js 落盘并自证。
 * 不读 stdin —— 容器里 `docker compose run` 会吞掉 stdin(踩过),所以入口只认参数与文件。
 */
async function runLogin({ cwd, now, deps, argv, log, err }) {
  const valueOf = (flag) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  let raw = valueOf('--cookie')
  const file = valueOf('--file')
  if (!raw && file) {
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (error) {
      err(`[失败] 读不到 ${file}:${error.message}`)
      return 1
    }
  }
  if (!raw) {
    err('用法:login --file <含 cookie 或整条 cURL 的文件> | --cookie "<内容>"')
    err('提示:MUSIC_U 约一周失效一次;换完会自动清掉当天的熔断标记')
    return 2
  }
  const result = await loginWithCookie({
    cwd,
    raw,
    now,
    deps: { ...deps, verify: deps.verify ?? verifyCookie }
  })
  if (!result.ok) {
    // 容器里 .env 是只读挂载:写不进去不是用户的错,直接告诉他去哪儿写
    if (/EROFS|EACCES|read-only/i.test(String(result.error))) {
      err('[失败] 这个环境里 .env 是只读的(容器挂载就是这样)')
      err('      请在宿主上跑:cd /srv/apps/automation/netease && ./set-cookie.sh')
      return 1
    }
    err(`[失败] ${result.error}`)
    return 1
  }
  log(`[保存] ACCOUNT_${result.account}_MUSIC_U 已写入 .env · 权限 600`)
  log(`[熔断] ${result.cleared ? '已清掉当天的熔断标记' : '当天本来没有熔断标记'}`)
  const verified = result.verified
  if (verified?.ok === true) {
    log(`[自证] 只读接口可用 · VIP 乐签状态:${verified.state ?? '已读取'}`)
    return 0
  }
  err(`[自证] 新 cookie 仍不可用:${verified?.error ?? '未知原因'}`)
  return 1
}

/** 默认自证:只读查一次 VIP 乐签状态,绝不调用签到接口。 */
async function verifyCookie({ cookie, deps }) {
  const { readVipState } = await import('./vip.js')
  const state = await readVipState({ cookie, deps })
  if (state?.ok === false) return { ok: false, error: state.error ?? '请求失败' }
  return { ok: true, state: state?.todaySigned === true ? '今天已签' : '今天未签' }
}
