#!/usr/bin/env node
// 锁状态查询入口(同伴程序与运维手动调用):
//
//   node scripts/windows/run-state.js lock-status   -> NONE | RUNNING | STALE | UNKNOWN
//   node scripts/windows/run-state.js lock-json     -> 锁文件里的 JSON,没有则 null
//   node scripts/windows/run-state.js free-mem      -> 可用内存 MB
//
// 为什么放在 scripts/windows/:同伴互查的口径固定是「读同伴的锁文件,再调同伴自己的
// <项目根>/scripts/windows/run-state.js lock-status」(见 src/guards.js 的 peerBusy),
// 仓库各程序共用这一条路径。本文件与平台无关,在 Linux 容器里照样能跑 ——
// 目录名是历史约定,不代表它只在 Windows 上用,别按它改名。
//
// 判定口径必须是 src/lock.js 的 lockState。三条结论各管一段:
//   RUNNING = host 相同且那个 pid 还活着;STALE = host 相同但进程没了,或锁内容是坏的;
//   UNKNOWN = 锁是别的容器/机器写的(host 不同),本机看不到它的进程表。
// 不许把 UNKNOWN 当 STALE 报给同伴:同伴据此才会按锁年龄保守让路,当成 STALE 会让
// 「他方查网易云」永远拿不到 RUNNING。取锁方另有一套口径(holderAlive:host 不同即回收),两者
// 在 src/lock.js 里分开实现。不许照抄姊妹项目那套「有没有 node 在跑」:那要查宿主进程表,
// 在容器里查不到,调用方会拿到空结论而退回「10 分钟内新锁保守让路」。
//
// 只读:不删也不写锁。残锁由持有者自己的 acquireLock 回收,同伴侧通常还是只读挂载。
import fs from 'node:fs'
import path from 'node:path'

import { freeMemoryMb } from '../../src/cli.js'
import { loadConfig } from '../../src/config.js'
import { lockFile, lockState, readLock } from '../../src/lock.js'

// 配置根固定为本文件所在的仓库目录,不看调用方的 cwd —— 同伴是在自己的容器里调这个脚本,
// cwd 与 ./data 都不在这里。NETEASE_STATE_DIR 与 NETEASE_LOCK_DIR 仍可按需覆盖。
const projectRoot = path.resolve(import.meta.dirname, '..', '..')
const config = loadConfig(projectRoot, { env: process.env })
const file = lockFile(config.lockDir)

/** NONE = 没锁;RUNNING = 活持有者;STALE = 残锁;UNKNOWN = 别的 host 写的,判不了死活。 */
export function lockStatus() {
  if (!fs.existsSync(file)) return 'NONE'
  return lockState(readLock(file)).toUpperCase()
}

const USAGE = `用法:node scripts/windows/run-state.js <命令>

  lock-status  锁状态:NONE | RUNNING | STALE | UNKNOWN
  lock-json    锁文件内容
  free-mem     可用内存 MB`

function main(argv) {
  const [command = 'lock-status'] = argv
  if (command === 'lock-status') {
    console.log(lockStatus())
    return 0
  }
  if (command === 'lock-json') {
    console.log(JSON.stringify(readLock(file)))
    return 0
  }
  if (command === 'free-mem') {
    console.log(freeMemoryMb())
    return 0
  }
  console.log(USAGE)
  return 1
}

process.exitCode = main(process.argv.slice(2))
