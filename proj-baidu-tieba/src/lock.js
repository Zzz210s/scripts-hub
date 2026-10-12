// 单实例锁:锁文件里只记 { pid, startedAt },是否有人持有以进程实况判定 ——
// 进程不存在即为残锁、立即回收,否则崩溃留下的锁会挡住当天所有重试。
// 不许用 proc.killed 判死活:kill() 之后它立刻为 true,而子进程可能还在跑
// (姊妹项目 child-exit 的实测教训);这里统一走 process.kill(pid, 0)。
import fs from 'node:fs';
import path from 'node:path';

export const LOCK_NAME = 'run.lock';

export const lockFile = (dir) => path.join(dir, LOCK_NAME);

/** 读锁;空文件或坏内容返回 null(调用方据此当残锁处理)。 */
export function readLock(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** pid 活着?EPERM 说明进程存在但不属于我们,同样算活着。 */
export const defaultIsAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
};

export function writeLock(file, { now = new Date(), pid = process.pid } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const holder = { pid, startedAt: now.toISOString() };
  fs.writeFileSync(file, JSON.stringify(holder), 'utf8');
  return holder;
}

export const clearLock = (file) => fs.rmSync(file, { force: true });

/** 有活着的持有者 -> 拿不到;残锁直接接管,不让崩溃过一次就锁死当天。 */
export function acquireLock(dir, { now = new Date(), isAlive = defaultIsAlive, pid = process.pid } = {}) {
  const file = lockFile(dir);
  if (fs.existsSync(file)) {
    const holder = readLock(file);
    if (holder && isAlive(holder.pid)) return { ok: false, stale: false, holder };
    clearLock(file);
    return { ok: true, stale: true, holder: writeLock(file, { now, pid }) };
  }
  return { ok: true, stale: false, holder: writeLock(file, { now, pid }) };
}

export function releaseLock(dir) {
  clearLock(lockFile(dir));
  return { ok: true };
}
