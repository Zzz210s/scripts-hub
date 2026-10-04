// 运行器辅助:判断"是否真的还有奖励脚本在跑"、看门狗要用的进程/内存信息。
//
//   node scripts\windows\run-state.js lock-status    -> NONE | RUNNING | STALE
//   node scripts\windows\run-state.js lock-age       -> 锁文件的年龄(分钟,无锁时输出 -1)
//   node scripts\windows\run-state.js lock-mtime     -> 锁文件的修改时间(毫秒,无锁时输出 -1)
//   node scripts\windows\run-state.js free-mem       -> 可用物理内存(MB)
//   node scripts\windows\run-state.js kill           -> 杀掉所有在跑 dist\index.js 的进程树,输出杀掉的个数
//   node scripts\windows\run-state.js count          -> 匹配到的进程个数(查询失败输出 -1)
//   node scripts\windows\run-state.js clock          -> "真实日期 逻辑日 HH:MM:SS"
//
// 逻辑日(logical day):本地 04:00 之前算作前一天。
// 为什么要它:2026-09-24 出过一次事故 —— 凌晨 02:19 的一次运行(补跑)完成后把
// "2026-09-24" 写成已完成,于是当天 11:30 开机后所有触发都被"一天只跑一遍"
// 规则跳过,那一整天没跑成。凌晨的运行其实还在同一个奖励日内(也拿不到新分),
// 所以以 04:00 为界既符合实际,也和每天 02:00 的关机配合:
// 关机后到 04:00 之间即便机器被人重新打开,运行也只计入前一天。
//
// REWARDS_NOW=2026-09-24T02:19:27 可覆盖"现在",仅用于测试。
//
// 为什么需要它:锁文件 logs\run.lock 由 run-daily.bat 创建、正常结束时删除。
// 若上次运行被异常中断(崩溃、被强杀、断电),锁会残留 —— 只按"锁存在"判断会
// 把后续所有触发挡掉一整天。这里以**进程**为权威:只要没有 node 在跑
// dist\index.js,残留锁就算 STALE,可以立即清掉重试。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOCK = path.join(root, 'logs', 'run.lock')
/** 进程查询失败时的兜底阈值:锁超过这个年龄就认为已经死了。 */
const FALLBACK_STALE_MINUTES = 90

const PS_QUERY =
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -match 'dist[\\\\/]index\\.js' } | " +
    'Measure-Object | Select-Object -ExpandProperty Count'

const PS_PIDS =
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -match 'dist[\\\\/]index\\.js' } | " +
    'Select-Object -ExpandProperty ProcessId'

/**
 * 进程匹配串。默认要求整条命令里同时出现项目目录名与 dist\index.js —— 只写
 * dist[\\/]index\.js 会误判:机器上任何跑 dist\index.js 的 node 进程(例如 MCP 服务)
 * 都会被算成"奖励脚本在跑",导致当天所有触发被误挡(2026-10-01 实测 count=10 全属误报)。
 * 仍可用 REWARDS_RUN_MATCH 覆盖,便于隔离测试看门狗。
 */
function matchPattern() {
    const pattern = process.env.REWARDS_RUN_MATCH || 'Microsoft-Rewards-Script[^"\\s]*[\\\\/]dist[\\\\/]index\\.js'
    return pattern.replace(/'/g, "''")
}

function psQuery(select) {
    return (
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
        `Where-Object { $_.CommandLine -match '${matchPattern()}' } | ` +
        select
    )
}

/** 进程查询超时。本机内存吃紧时 PowerShell 冷启动可到 20 秒以上,不能掐太紧。 */
const QUERY_TIMEOUT_MS = 90000

/** 正在跑 dist\index.js 的 node 进程数;查询失败返回 -1。 */
function runningScripts() {
    try {
        const out = execFileSync(
            'powershell.exe',
            ['-NoProfile', '-Command', psQuery('Measure-Object | Select-Object -ExpandProperty Count')],
            { encoding: 'utf8', timeout: QUERY_TIMEOUT_MS }
        )
        return Number(out.trim()) || 0
    } catch {
        return -1
    }
}

function lockAgeMinutes() {
    try {
        return (Date.now() - fs.statSync(LOCK).mtimeMs) / 60000
    } catch {
        return -1
    }
}

/** 锁文件的修改时间(毫秒);无锁返回 -1。看门狗用它区分"同一次运行"与"新的一次运行"。 */
function lockMtime() {
    try {
        return Math.round(fs.statSync(LOCK).mtimeMs)
    } catch {
        return -1
    }
}

/** 可用物理内存(MB);读取失败返回 -1。内存吃紧时运行器会降到单集群。 */
function freeMemoryMb() {
    return Math.round(os.freemem() / (1024 * 1024))
}

/** 在跑 dist\index.js 的 node 进程号列表。 */
function runningPids() {
    try {
        return execFileSync('powershell.exe', ['-NoProfile', '-Command', psQuery('Select-Object -ExpandProperty ProcessId')], {
            encoding: 'utf8',
            timeout: QUERY_TIMEOUT_MS
        })
            .split(/\s+/)
            .map(value => Number(value))
            .filter(value => Number.isInteger(value) && value > 0)
    } catch {
        return []
    }
}

/** 一次 PowerShell 调用内完成"找到就杀"，返回真正杀掉的个数。 */
function psKill() {
    return (
        '$n = 0; ' +
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
        `Where-Object { $_.CommandLine -match '${matchPattern()}' } | ` +
        'ForEach-Object { taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $n++ } }; ' +
        '$n'
    )
}

/** 杀掉整棵进程树(浏览器子进程一并结束),返回成功杀掉的个数。 */
function killRunners() {
    try {
        const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', psKill()], {
            encoding: 'utf8',
            timeout: QUERY_TIMEOUT_MS
        })
        const killed = Number(out.trim().split(/\s+/).pop())
        if (Number.isInteger(killed) && killed > 0) return killed

        // 单次调用没成(或 PowerShell 没给出数字):退回逐个 taskkill
        let fallback = 0
        for (const pid of runningPids()) {
            try {
                execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 30000 })
                fallback++
            } catch {
                // 进程可能已经自己退出
            }
        }
        return fallback
    } catch {
        return 0
    }
}

function lockStatus() {
    const count = runningScripts()
    const lockExists = fs.existsSync(LOCK)

    if (count > 0) return 'RUNNING'
    if (count === 0) return lockExists ? 'STALE' : 'NONE'

    // 进程查询失败:按锁的年龄兜底,宁可放行也不要卡死一天
    if (!lockExists) return 'NONE'
    return lockAgeMinutes() > FALLBACK_STALE_MINUTES ? 'STALE' : 'RUNNING'
}

const command = process.argv[2] ?? 'lock-status'

/** 逻辑日的分界小时:在此之前算前一天。 */
const DAY_CUTOFF_HOUR = 4

/** 当前时间;REWARDS_NOW 可覆盖(测试用)。 */
function currentDate() {
    const override = process.env.REWARDS_NOW
    if (override) {
        const parsed = new Date(override)
        if (!Number.isNaN(parsed.getTime())) return parsed
    }
    return new Date()
}

const pad = value => String(value).padStart(2, '0')

/** 本地日期 YYYY-MM-DD。 */
function localDay(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** "真实日期 逻辑日 HH:MM:SS" —— 运行器一次调用拿齐日期与时钟。 */
function dayContext() {
    const now = currentDate()
    const logical = new Date(now)
    if (logical.getHours() < DAY_CUTOFF_HOUR) logical.setDate(logical.getDate() - 1)
    const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    return `${localDay(now)} ${localDay(logical)} ${clock}`
}

if (command === 'lock-status') {
    process.stdout.write(`${lockStatus()}\n`)
} else if (command === 'lock-age') {
    process.stdout.write(`${lockAgeMinutes()}\n`)
} else if (command === 'lock-mtime') {
    process.stdout.write(`${lockMtime()}\n`)
} else if (command === 'free-mem') {
    process.stdout.write(`${freeMemoryMb()}\n`)
} else if (command === 'kill') {
    process.stdout.write(`${killRunners()}\n`)
} else if (command === 'count') {
    process.stdout.write(`${runningScripts()}\n`)
} else if (command === 'clock') {
    process.stdout.write(`${dayContext()}\n`)
} else {
    process.stderr.write('用法: node run-state.js [lock-status|lock-age|lock-mtime|free-mem|kill|count|clock]\n')
    process.exitCode = 2
}
