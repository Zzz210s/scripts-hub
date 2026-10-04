// 运行器的辅助命令(供 .bat 调用):单实例锁、今日配额、看门狗用的锁时间戳、强杀。
//
//   node scripts/windows/run-state.js lock-status   -> NONE | RUNNING | STALE
//   node scripts/windows/run-state.js lock|unlock
//   node scripts/windows/run-state.js lock-mtime    -> 锁文件的毫秒时间戳(看门狗用)
//   node scripts/windows/run-state.js quota         -> MET | PENDING
//   node scripts/windows/run-state.js kill          -> 杀掉正在跑的底座进程
//   node scripts/windows/run-state.js free-mem      -> 可用物理内存(MB)
//
// 锁的判定以"进程是否真的在跑"为准:上次崩溃/断电留下的残锁立即回收,
// 否则会挡住当天所有重试(微软积分项目踩过这个坑)。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const LOCK = path.join(ROOT, 'logs', 'run.lock')
const MATCH = process.env.WEREAD_RUN_MATCH ?? 'weread-bot.py'

function ps(command) {
    try {
        return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
            encoding: 'utf8',
            timeout: 90000
        }).trim()
    } catch {
        return ''
    }
}

/** 正在跑底座的进程(pid 列表)。 */
export function runningPids() {
    const out = ps(`Get-CimInstance Win32_Process -Filter "name='python.exe' or name='pythonw.exe'" | Where-Object { $_.CommandLine -like '*${MATCH}*' } | Select-Object -ExpandProperty ProcessId`)
    return out.split(/\s+/).filter(Boolean).map(Number)
}

export function lockStatus() {
    if (!fs.existsSync(LOCK)) return 'NONE'
    const pids = runningPids()
    if (pids.length) return 'RUNNING'
    fs.rmSync(LOCK, { force: true })
    return 'STALE'
}

function writeLock() {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true })
    fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8')
}

function lockMtime() {
    if (!fs.existsSync(LOCK)) return 0
    return Math.round(fs.statSync(LOCK).mtimeMs)
}

/** 今日是否已达标:读 data/state.json(由 src/state.js 维护)。 */
function quota() {
    try {
        const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'state.json'), 'utf8'))
        const today = new Date()
        const pad = value => String(value).padStart(2, '0')
        const key = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
        if (state.date !== key) return 'PENDING'
        return state.done ? 'MET' : 'PENDING'
    } catch {
        return 'PENDING'
    }
}

function freeMemMb() {
    return Math.round(os.freemem() / 1048576)
}

function kill() {
    const pids = runningPids()
    let killed = 0
    for (const pid of pids) {
        try {
            execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 30000 })
            killed += 1
        } catch { /* 进程可能已退出 */ }
    }
    const left = runningPids().length
    fs.rmSync(LOCK, { force: true })
    return { killed, remaining: left }
}

const [command] = process.argv.slice(2)
switch (command) {
    case 'lock': writeLock(); console.log('locked'); break
    case 'unlock': fs.rmSync(LOCK, { force: true }); console.log('unlocked'); break
    case 'lock-status': console.log(lockStatus()); break
    case 'lock-mtime': console.log(lockMtime()); break
    case 'quota': console.log(quota()); break
    case 'free-mem': console.log(freeMemMb()); break
    case 'pids': console.log(runningPids().join(' ')); break
    case 'kill': {
        const result = kill()
        console.log(`killed=${result.killed} remaining=${result.remaining}`)
        break
    }
    default:
        console.log('用法:node scripts/windows/run-state.js lock|unlock|lock-status|lock-mtime|quota|free-mem|pids|kill')
}
