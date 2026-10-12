#!/usr/bin/env node
// 锁状态查询入口(同伴程序与运维手动调用):
//
//   node scripts/windows/run-state.js lock-status   -> NONE | RUNNING | STALE
//   node scripts/windows/run-state.js lock-json     -> 锁文件里的 JSON,没有则 null
//   node scripts/windows/run-state.js free-mem      -> 可用内存 MB
//
// 为什么放在 scripts/windows/:同伴互查的口径固定是「读同伴的锁文件,再调同伴自己的
// <项目根>/scripts/windows/run-state.js lock-status」(见 src/guards.js 的 peerBusy),
// 仓库里五个程序共用这一条路径。本文件与平台无关,在 Linux 容器里照样能跑 ——
// 目录名是历史约定,不代表它只在 Windows 上用,别按它改名。
//
// 判定口径必须是 src/lock.js 的 holderAlive,不许照抄姊妹项目那套「有没有 node 在跑」:
// 后者要查宿主进程表,在容器里查不到,调用方会拿到空结论而退回「10 分钟内新锁保守让路」。
// holderAlive 只看锁文件:host 与当前不同 = 别的容器或上次运行留下的,pid 复用不算持有者。
//
// 只读:不删也不写锁。残锁由持有者自己的 acquireLock 回收,同伴侧通常还是只读挂载。
import fs from 'node:fs';
import path from 'node:path';

import { freeMemoryMb } from '../../src/cli.js';
import { loadConfig } from '../../src/config.js';
import { holderAlive, lockFile, readLock } from '../../src/lock.js';

// 配置根固定为本文件所在的仓库目录,不看调用方的 cwd —— 同伴是在自己的容器里调这个脚本,
// cwd 与 ./data 都不在这里。TIEBA_STATE_DIR 仍可按需覆盖。
const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const config = loadConfig(projectRoot, { env: process.env });
const file = lockFile(config.stateDir);

/** NONE = 没有锁;RUNNING = 有活着的持有者;STALE = 有锁但持有者不在了。 */
export function lockStatus() {
  if (!fs.existsSync(file)) return 'NONE';
  return holderAlive(readLock(file)) ? 'RUNNING' : 'STALE';
}

const USAGE = `用法:node scripts/windows/run-state.js <命令>

  lock-status  锁状态:NONE | RUNNING | STALE
  lock-json    锁文件内容
  free-mem     可用内存 MB`;

function main(argv) {
  const [command = 'lock-status'] = argv;
  if (command === 'lock-status') {
    console.log(lockStatus());
    return 0;
  }
  if (command === 'lock-json') {
    console.log(JSON.stringify(readLock(file)));
    return 0;
  }
  if (command === 'free-mem') {
    console.log(freeMemoryMb());
    return 0;
  }
  console.log(USAGE);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
