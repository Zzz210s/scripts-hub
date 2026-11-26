// 单实例锁:锁文件里记 { pid, host, startedAt },是否有人持有以「host + 进程实况」判定。
// 部署在一次性容器里时每次运行的 hostname 都不同,只看 pid 会把旧容器留下的残锁当活持有者,
// 于是每次触发都静默跳过(贴吧 2026-10 踩过)。所以 host 不同一律当残锁回收。
// 不许用 proc.killed 判死活:kill() 之后它立刻为 true,而子进程可能还在跑。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const LOCK_NAME = 'run.lock'
export const lockFile = (dir) => path.join(dir, LOCK_NAME)

export function readLock(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** pid 活着?EPERM 说明进程存在但不属于我们,同样算活着。 */
export const defaultIsAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** 三态:running(本机活进程)/ stale(可回收残锁)/ unknown(别的 host 写的,本机看不到它的进程表)。 */
export function lockState(holder, { isAlive = defaultIsAlive, hostname = os.hostname() } = {}) {
  if (!holder) return 'stale'
  if (typeof holder.host === 'string' && holder.host && holder.host !== hostname) return 'unknown'
  return isAlive(holder.pid) ? 'running' : 'stale'
}

export const holderAlive = (holder, options) => lockState(holder, options) === 'running'

/** 独占创建(wx):文件已存在时抛 EEXIST,由 acquireLock 重读后裁决。 */
export function writeLock(file, { now = new Date(), pid = process.pid, hostname = os.hostname() } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const holder = { pid, host: hostname, startedAt: now.toISOString() }
  fs.writeFileSync(file, JSON.stringify(holder), { encoding: 'utf8', flag: 'wx' })
  return holder
}

export const clearLock = (file) => fs.rmSync(file, { force: true })

/** 抢锁:wx 消除 TOCTOU;残锁清掉重试,不让崩溃过一次就锁死当天。 */
export function acquireLock(dir, { now = new Date(), isAlive = defaultIsAlive, pid = process.pid, hostname = os.hostname() } = {}) {
  const file = lockFile(dir)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const holder = writeLock(file, { now, pid, hostname })
      return { ok: true, stale: attempt > 0, holder }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    const current = readLock(file)
    if (holderAlive(current, { isAlive, hostname })) return { ok: false, stale: false, holder: current }
    clearLock(file)
  }
  return { ok: false, stale: false, holder: readLock(file) }
}

/** 只释放本进程自己持有的锁:持有者换人了就别删别人的。 */
export function releaseLock(dir, { pid = process.pid, hostname = os.hostname() } = {}) {
  const file = lockFile(dir)
  const holder = readLock(file)
  if (holder && (holder.host !== hostname || holder.pid !== pid)) return { ok: false, released: false, reason: 'not-holder', holder }
  clearLock(file)
  return { ok: true, released: true }
}
