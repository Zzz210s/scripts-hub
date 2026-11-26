// 守卫:什么情况下该空手退出。每条都在日志里写清原因 —— 静默跳过比失败更难查。
// 与套件的约定一致:同伴在跑 / 当天已完成 / 安静时段 / 手动暂停。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inQuietHours, minutesOfDay } from './clock.js'
import { lockState, readLock } from './lock.js'

/**
 * 同伴是否在跑。别的程序写的锁 host 与本机不同,本机看不到它的进程表 —— 那种情况按锁文件年龄判:
 * 3 小时以内当它在跑,超时就当残锁(与贴吧/B站的阈值一致)。
 */
export function peerBusy(files, { now = new Date(), maxAgeMinutes = 180, hostname = os.hostname() } = {}) {
  for (const file of files) {
    const holder = readLock(file)
    if (!holder) continue
    const state = lockState(holder, { hostname })
    if (state === 'running') return file
    if (state === 'unknown') {
      const started = Date.parse(holder.startedAt ?? '')
      if (Number.isFinite(started) && now.getTime() - started < maxAgeMinutes * 60000) return file
    }
  }
  return null
}

export const paused = (dir) => fs.existsSync(path.join(dir, 'paused'))

/** 返回 {skip, reason};skip 为真时调用方直接退出(退出码 0,不是失败)。 */
export function guard({ config, state, day, now = new Date(), claimedToday }) {
  if (paused(config.stateDir)) return { skip: true, reason: '手动暂停(data/paused 存在)' }
  const minutes = minutesOfDay(now)
  if (inQuietHours(minutes, config.quietStart, config.quietEnd)) {
    return { skip: true, reason: `安静时段 ${config.quietStart}–${config.quietEnd}` }
  }
  const busy = peerBusy(config.busyPeers, { now })
  if (busy) return { skip: true, reason: `同伴在跑:${path.basename(path.dirname(busy))}` }
  const todo = config.accounts.filter((account) => !claimedToday(state, day, account.id))
  if (!todo.length) return { skip: true, reason: `${day} 全部账号今天已领过` }
  return { skip: false, reason: null, accounts: todo }
}
