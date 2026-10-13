// T7:本地段守卫(纯函数,不联网)与同伴互查。
// 顺序固定,只报第一个命中的原因 —— 与姊妹程序一致:
// paused -> done-today -> circuit-broken -> attempts-exhausted -> peer-running
// -> quiet-hours -> before-shutdown -> low-memory。
// circuit-broken 与 done-today 同属「今天已有结论」,但结论相反:熔断当天不再请求,等明天。
// 单实例锁不在这里:本段是只读判定,run.js 让它在取锁**之前**先跑 —— 不联网就能跳过的
// 情况(暂停、今天已完成、熔断等)不该先抢锁。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { minutesOfDay } from './clock.js'

export const DEFAULT_LIMITS = {
  quietStart: '20:00',
  quietEnd: '23:00',
  shutdownTime: '02:00',
  shutdownMarginMinutes: 30,
  minFreeMb: 800,
}

/** 'HH:MM' -> 当天分钟数;格式不对给 null。 */
export const parseClock = (clock) => {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(clock ?? ''))
  return matched ? Number(matched[1]) * 60 + Number(matched[2]) : null
}

/** 落在安静时段内(窗口可跨零点)。 */
export function quietHours(now = new Date(), start = DEFAULT_LIMITS.quietStart, end = DEFAULT_LIMITS.quietEnd) {
  const from = parseClock(start)
  const to = parseClock(end)
  if (from === null || to === null) return false
  const minute = minutesOfDay(now)
  return from <= to ? minute >= from && minute < to : minute >= from || minute < to
}

/** 距关机时刻不足 margin 分钟(跨零点)。 */
export function shutdownGuard(
  now = new Date(),
  shutdown = DEFAULT_LIMITS.shutdownTime,
  marginMinutes = DEFAULT_LIMITS.shutdownMarginMinutes,
) {
  const at = parseClock(shutdown)
  if (at === null) return false
  return (at - minutesOfDay(now) + 1440) % 1440 < marginMinutes
}

/**
 * 第一段守卫:不联网、秒级返回。`doneToday` 只认业务读回确认后的结论,
 * `circuitBroken` 是当天熔断(鉴权/限流)标记,`attempts` 是当天已尝试次数。
 * 返回 { action: 'run' | 'skip', reason, detail }。
 */
export function checkLocalGuards({
  now = new Date(),
  paused = false,
  doneToday = false,
  circuitBroken = false,
  attempts = 0,
  maxAttempts = 3,
  peerRunning = false,
  peerDetail = '',
  freeMb = Infinity,
  limits = {},
} = {}) {
  const cfg = { ...DEFAULT_LIMITS, ...limits }
  if (paused) return { action: 'skip', reason: 'paused', detail: '' }
  if (doneToday) return { action: 'skip', reason: 'done-today', detail: '' }
  if (circuitBroken) return { action: 'skip', reason: 'circuit-broken', detail: '' }
  if (attempts >= maxAttempts) {
    return { action: 'skip', reason: 'attempts-exhausted', detail: `${attempts}/${maxAttempts}` }
  }
  if (peerRunning) return { action: 'skip', reason: 'peer-running', detail: peerDetail }
  if (quietHours(now, cfg.quietStart, cfg.quietEnd)) {
    return { action: 'skip', reason: 'quiet-hours', detail: `${cfg.quietStart}-${cfg.quietEnd}` }
  }
  if (shutdownGuard(now, cfg.shutdownTime, cfg.shutdownMarginMinutes)) {
    return { action: 'skip', reason: 'before-shutdown', detail: `${cfg.shutdownMarginMinutes} 分钟内关机` }
  }
  if (freeMb < cfg.minFreeMb) {
    return { action: 'skip', reason: 'low-memory', detail: `${freeMb}MB < ${cfg.minFreeMb}MB` }
  }
  return { action: 'run', reason: 'ok', detail: '' }
}

/**
 * 第二段守卫:凭据体检的结论。单账号失效不该把整轮判死 ——
 * 只有全部账号都不可用、或压根没配账号时才拦。
 */
export function checkOnlineGuards({ credentials = [] } = {}) {
  if (!Array.isArray(credentials) || credentials.length === 0) {
    return { action: 'skip', reason: 'no-credentials', detail: '未配置账号' }
  }
  // 收紧为显式 ok:true 才算可用 —— 缺字段必须是禁用而不是放行(fail-closed)。
  const usable = credentials.filter((item) => item?.ok === true)
  if (usable.length === 0) {
    return { action: 'skip', reason: 'credentials-invalid', detail: `全部 ${credentials.length} 个账号凭据失效` }
  }
  const broken = credentials.length - usable.length
  return {
    action: 'run',
    reason: 'ok',
    detail: broken > 0 ? `${broken} 个账号凭据失效,其余照跑` : '',
  }
}

/**
 * 同伴是否在跑:读同伴的锁文件,存在就调它自己的 `run-state.js lock-status`
 * (它知道残锁与进程实况)。不看锁文件年龄 —— 早期实现按年龄判定出过误报。
 * 只有查不通时才用「10 分钟内的新锁保守让路」兜底。
 * `nowMs` 是毫秒时间戳(与 stat.mtimeMs 同单位),不是 Date —— 调方别传 Date。
 */
export function peerBusy(lockFiles, { exec = execFileSync, timeoutMs = 60000, nowMs = Date.now() } = {}) {
  for (const file of lockFiles ?? []) {
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      continue
    }
    const projectDir = path.resolve(path.dirname(file), '..')
    const project = path.basename(projectDir)
    const ageMinutes = Math.max(0, Math.round((nowMs - stat.mtimeMs) / 60000))

    let verdict = ''
    const checkScript = path.join(projectDir, 'scripts', 'windows', 'run-state.js')
    if (fs.existsSync(checkScript)) {
      try {
        verdict = exec('node', [checkScript, 'lock-status'], {
          encoding: 'utf8',
          timeout: timeoutMs,
          windowsHide: true,
        }).trim()
      } catch {
        /* 查不通时走年龄兜底 */
      }
    }
    if (verdict === 'RUNNING') return { busy: true, project, detail: `${project} 正在运行` }
    if (verdict === 'STALE' || verdict === 'NONE') continue // 残锁不挡路
    // UNKNOWN(锁是别的容器/机器写的)与查不通一样:没法确认它不忙,
    // 只能按锁文件年龄保守让路 —— 10 分钟内的新锁当作在跑。
    if (verdict === 'UNKNOWN' && ageMinutes < 10) {
      return { busy: true, project, detail: `${project} 锁状态未知 · 锁创建于 ${ageMinutes} 分钟前` }
    }
    if (ageMinutes < 10) return { busy: true, project, detail: `${project} 可能刚启动 · 锁创建于 ${ageMinutes} 分钟前` }
  }
  return { busy: false }
}
