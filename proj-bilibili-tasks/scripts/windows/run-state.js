// 运行器的辅助命令(供 run-daily.bat 调用):单实例锁、当日配额、可用内存、强杀。
//
//   node scripts/windows/run-state.js lock-status   -> NONE | RUNNING | STALE
//   node scripts/windows/run-state.js lock | unlock
//   node scripts/windows/run-state.js quota         -> MET | PENDING
//   node scripts/windows/run-state.js free-mem      -> 可用物理内存(MB)
//   node scripts/windows/run-state.js pids | kill
//
// 锁的「在跑」判定以进程实况为准(有没有 node 在跑 cli.js),不是锁文件里的 pid ——
// run-state.js 写完锁就退出了;崩溃留下的残锁会立刻被回收。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { loadConfig } from '../../src/config.js'
import { loadState, attemptsToday } from '../../src/state.js'
import { clearLock, defaultIsAlive, readLock, writeLock } from '../../src/lock.js'

const config = loadConfig()
const MATCH = process.env.BILIBILI_RUN_MATCH ?? 'cli.js'

function powershell(command) {
    try {
        return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 90000 }).trim()
    } catch {
        return ''
    }
}

/** 正在跑薄壳的 node 进程 pid 列表。 */
export function runningPids() {
    const out = powershell(`Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -like '*${MATCH}*' } | Select-Object -ExpandProperty ProcessId`)
    return out.split(/\s+/).filter(Boolean).map(Number)
}

const lockStatus = () => {
    if (!fs.existsSync(config.lockFile)) return 'NONE'
    if (runningPids().length > 0) return 'RUNNING'
    clearLock(config.lockFile)
    return 'STALE'
}

/** 今天的尝试次数是否已经用尽 —— 用尽就别再起 Console。 */
function quota() {
    const { state } = loadState(config.stateFile)
    return attemptsToday(state, new Date(), config.dayBoundaryHour) >= config.maxAttempts ? 'MET' : 'PENDING'
}

const freeMemMb = () => Math.round(os.freemem() / 1048576)

function kill() {
    let killed = 0
    for (const pid of runningPids()) {
        try {
            execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 30000 })
            killed += 1
        } catch { /* 可能已退出 */ }
    }
    clearLock(config.lockFile)
    return { killed, remaining: runningPids().length }
}

const [command] = process.argv.slice(2)
switch (command) {
    case 'lock': writeLock(config.lockFile); console.log('locked'); break
    case 'unlock': clearLock(config.lockFile); console.log('unlocked'); break
    case 'lock-status': console.log(lockStatus()); break
    case 'lock-json': console.log(JSON.stringify(readLock(config.lockFile))); break
    case 'quota': console.log(quota()); break
    case 'free-mem': console.log(freeMemMb()); break
    case 'pids': console.log(runningPids().join(' ')); break
    case 'is-alive': console.log(defaultIsAlive(Number(process.argv[3])) ? 'yes' : 'no'); break
    case 'kill': {
        const result = kill()
        console.log(`killed=${result.killed} remaining=${result.remaining}`)
        break
    }
    default:
        console.log('用法:node scripts/windows/run-state.js lock|unlock|lock-status|quota|free-mem|pids|kill')
}
