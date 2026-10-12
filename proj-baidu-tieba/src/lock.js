// 单实例锁:锁文件里记 { pid, host, startedAt },是否有人持有以「host + 进程实况」判定。
// 本项目部署在 Docker 一次性容器里,每次运行的 hostname 都不同;只看 pid 的话,
// 上次被 SIGKILL 留下的旧容器 pid 常被新容器的 node 占用,残锁会被当成活持有者 ->
// 每次触发静默跳过、退出码 0(B站 guard-skipped 那次事故的同一类失败)。
// 所以先比 host:不同 host 一律当残锁回收;host 相同(或缺省)才看进程实况。
// 不许用 proc.killed 判死活:kill() 之后它立刻为 true,而子进程可能还在跑
// (姊妹项目 child-exit 的实测教训);这里统一走 process.kill(pid, 0)。
import fs from 'node:fs';
import os from 'node:os';
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

/**
 * 持有者是否还活着:先比 host。锁里 host 与当前 hostname 不同 = 别的容器
 * 或别的机器留下的残锁,pid 复用也不代表它还在跑;host 相同或缺失才回落到
 * isAlive(pid)。
 */
export const holderAlive = (holder, { isAlive = defaultIsAlive, hostname = os.hostname() } = {}) => {
  if (!holder) return false;
  if (typeof holder.host === 'string' && holder.host && holder.host !== hostname) return false;
  return isAlive(holder.pid);
};

/** 独占创建锁文件(wx):文件已存在时抛 EEXIST,由 acquireLock 重读后裁决。 */
export function writeLock(file, { now = new Date(), pid = process.pid, hostname = os.hostname() } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const holder = { pid, host: hostname, startedAt: now.toISOString() };
  fs.writeFileSync(file, JSON.stringify(holder), { encoding: 'utf8', flag: 'wx' });
  return holder;
}

export const clearLock = (file) => fs.rmSync(file, { force: true });

/**
 * 抢锁:wx 独占创建消除「先查存在再写」的 TOCTOU;EEXIST 时重读再判活。
 * 有活着的持有者 -> 拿不到;残锁(含跨 host 的)清掉后重试,不让崩溃过一次
 * 就锁死当天。
 */
export function acquireLock(
  dir,
  { now = new Date(), isAlive = defaultIsAlive, pid = process.pid, hostname = os.hostname() } = {},
) {
  const file = lockFile(dir);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const holder = writeLock(file, { now, pid, hostname });
      return { ok: true, stale: attempt > 0, holder };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const current = readLock(file);
    if (holderAlive(current, { isAlive, hostname })) return { ok: false, stale: false, holder: current };
    clearLock(file);
  }
  return { ok: false, stale: false, holder: readLock(file) };
}

/** 只释放本进程自己持有的锁:持有者换人了(host 或 pid 不符)就别删别人的。 */
export function releaseLock(dir, { pid = process.pid, hostname = os.hostname() } = {}) {
  const file = lockFile(dir);
  const holder = readLock(file);
  if (holder && (holder.host !== hostname || holder.pid !== pid)) {
    return { ok: false, released: false, reason: 'not-holder', holder };
  }
  clearLock(file);
  return { ok: true, released: true };
}
