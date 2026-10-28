// 只读子命令与发送助手:check / probe / report、历史读取、企业微信发送。
// 从 cli.js 拆出(2026-10-26,守 200 行上限);cli.js 只留参数解析与分发。
import fs from 'node:fs'

import { call } from './client.js'
import { dateText, logicalDay } from './clock.js'
import { PATHS } from './crypto.js'
import { buildResult } from './messages.js'
import { pace } from './pacing.js'
import { sendWecom } from './notify.js'
import { attemptsOn, doneToday, historyFile, readState } from './state.js'
import { readAccounts, vipWord } from './probe.js'
import { queryYunbei, renderYunbeiLine } from './yunbei.js'

async function sendViaWecom(text, config, deps) {
  return sendWecom(text, { webhookFile: config.webhookFile, fetchImpl: deps.fetchImpl, sleep: deps.sleep })
}

/** 历史文件里当天最后一条记录;没有就返回 null。坏行跳过,不让一行脏数据废掉报告。 */
export function lastEntryForDay(day, dir, fsImpl = fs) {
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
export async function runCheck({ config, deps, now, log }) {
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
export async function runProbe({ config, deps, now, log }) {
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
export async function runReport({ config, deps, now, dry, log }) {
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
