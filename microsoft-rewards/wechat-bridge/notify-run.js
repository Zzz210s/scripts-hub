// Build a compact run summary from a run-daily.bat log and push it to WeChat.
// Usage: node wechat-bridge/notify-run.js "logs/last-run.log"
import fs from 'node:fs'

import { broadcast, channelStatus } from './lib/channels.js'
import { explainLowScore, LOW_SCORE_THRESHOLD } from './lib/diagnose.js'
import { lastKnown, readHistory, recordRun } from './lib/history.js'

const FAILURE_MARKERS = [
    /flow failed for/i,
    /\[ACCOUNT-ERROR\]/,
    /\[CLUSTER-WORKER-ERROR\]/,
    /fatal error:/i,
    // 运行器自己的结论行(它已经按退出码 + 日志标记判过一轮),以及看门狗强杀:
    // 强杀时即使已完成部分账号也不算当天完成,通知里必须说出来。
    /=== run finished with FAILURES/,
    /\[WATCHDOG\] run killed after/
]
const KILLED_RE = /\[WATCHDOG\] run killed after (\d+) minutes/

const RUN_END_RE = /\[RUN-END\] Completed all accounts \| accountsProcessed=(\d+) \| pointsGained=(\d+) \| previousBalance=(\d+) \| currentBalance=(\d+) \| runtimeMinutes=([\d.]+)/
const ACCOUNT_END_RE = /\[ACCOUNT-END\] Completed account: (\S+) \| pointsGained=(\d+) \| previousBalance=(\d+) \| currentBalance=(\d+) \| durationSeconds=([\d.]+)/

function shortReason(line) {
    return line
        .replace(/\[[^\]]*\]\s*/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 80)
}

/** Local (not UTC) YYYY-MM-DD, so an early-morning run is not dated yesterday. */
function localDay(date) {
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Returns { text, history } where text is the message (or null when nothing to tell). */
export function buildSummary(lines, { date = new Date() } = {}) {
    const runEnd = lines
        .map(l => l.match(RUN_END_RE))
        .filter(Boolean)
        .sort((a, b) => Number(b[5]) - Number(a[5]))[0] // longest phase = whole run
    const accountEnds = lines.map(l => l.match(ACCOUNT_END_RE)).filter(Boolean)
    const failures = lines.filter(line => FAILURE_MARKERS.some(re => re.test(line)))
    const skipped = lines.some(line => /day \d{4}-\d{2}-\d{2} already handled/.test(line))

    if (skipped) return { text: null, history: [] }
    if (!runEnd && !failures.length) return { text: null, history: [] }

    const stamp = localDay(date)
    const history = []

    if (!runEnd && !accountEnds.length) {
        const killLine = lines.find(line => KILLED_RE.test(line))
        const reason = killLine ? shortReason(killLine) : failures.length ? shortReason(failures[0]) : '原因未识别'
        const previous = lastKnown()
        const tail = previous ? `\n累计积分(上次成功运行)${previous.balance} 分` : ''
        return { text: `[Microsoft Rewards] ${stamp} 运行有失败\n失败原因: ${reason}${tail}`, history }
    }

    // A run reports one ACCOUNT-END per phase (main flow, app/bonus phase, ...), so the
    // per-account totals have to be taken from the first and the last record, not summed.
    const perAccount = new Map()
    for (const match of accountEnds) {
        const [, email, gained, before, after] = match
        const entry = perAccount.get(email) ?? { email, before: Number(before), after: Number(after), gained: 0 }
        entry.after = Number(after)
        entry.gained += Number(gained)
        perAccount.set(email, entry)
    }

    const rows = []
    let totalGained = 0
    const multi = perAccount.size > 1
    for (const entry of perAccount.values()) {
        const delta = Math.max(entry.gained, entry.after - entry.before)
        totalGained += delta
        history.push({ account: entry.email, gained: delta, before: entry.before, balance: entry.after, day: stamp })
        rows.push(`账号 ${entry.email}: 本次 +${delta} 分${multi ? ` | 累计 ${entry.after} 分` : ''}`)
    }

    const runtime = runEnd ? Number(runEnd[5]).toFixed(1) : null
    const parts = [`[Microsoft Rewards] ${stamp} ${failures.length ? '运行有失败' : '运行成功'}`, ...rows]

    if (!perAccount.size && runEnd) {
        parts.push(`累计积分 ${runEnd[4]} 分(运行前 ${runEnd[3]})`)
        totalGained = Number(runEnd[2])
    } else if (perAccount.size === 1) {
        const only = [...perAccount.values()][0]
        parts.push(`累计积分 ${only.after} 分(运行前 ${only.before})`)
    }

    const accountCount = perAccount.size || (runEnd ? runEnd[1] : 0)
    parts.push(`账号数 ${accountCount} | 本次共 +${totalGained} 分${runtime ? ` | 耗时 ${runtime} 分钟` : ''}`)

    // Several runs can happen in one day (a failed attempt plus a retry, or a
    // targeted re-run); show the day's total per account once that is the case.
    // 同一份日志可能被重复推送,先去重再统计,避免把同一次运行算两遍。
    const seenRecords = new Set()
    const todayRecords = [...readHistory(), ...history]
        .filter(entry => entry.day === stamp)
        .filter(entry => {
            const key = `${entry.account}|${entry.before}|${entry.balance}|${entry.gained}`
            if (seenRecords.has(key)) return false
            seenRecords.add(key)
            return true
        })
    const runsPerAccount = new Map()
    for (const entry of todayRecords) {
        runsPerAccount.set(entry.account, (runsPerAccount.get(entry.account) ?? 0) + 1)
    }
    const dayGain = account =>
        todayRecords.filter(entry => entry.account === account).reduce((total, entry) => total + entry.gained, 0)

    if ([...runsPerAccount.values()].some(count => count > 1)) {
        // 当天跑了不止一次:逐账号行改成以"今日"为主 —— 否则第二次补跑的推送里
        // 已领完的账号会显示"本次 +0",看上去像今天什么都没拿到(2026-09-25 用户问到过)。
        let index = 0
        for (const entry of perAccount.values()) {
            const delta = Math.max(entry.gained, entry.after - entry.before)
            parts[index + 1] = `账号 ${entry.email}: 今日 +${dayGain(entry.email)} 分(本次 +${delta})${multi ? ` | 累计 ${entry.after} 分` : ''}`
            index += 1
        }

        const totals = [...runsPerAccount.keys()].map(account => `${account} +${dayGain(account)}`)
        parts.push(`今日累计: ${totals.join(' | ')}`)
    }

    if (failures.length) parts.push(`失败条目 ${failures.length} 条,首条: ${shortReason(failures[0])}`)

    // 低分账号补一句归因:2026-09-27 用户问过"为什么有的账号只 +15",
    // 查下来是运行前配额已被领完、脚本按状态正确跳过,推送里不说清楚就看不出来。
    const lowScore = []
    for (const entry of perAccount.values()) {
        const delta = Math.max(entry.gained, entry.after - entry.before)
        if (delta > LOW_SCORE_THRESHOLD) continue
        const reason = explainLowScore(entry.email, lines)
        if (reason) lowScore.push(`${entry.email} 本次 +${delta} 分:${reason}`)
    }
    if (lowScore.length) parts.push(`低分原因 ${lowScore.join(' | ')}`)

    const killed = lines.map(line => line.match(KILLED_RE)).find(Boolean)
    if (killed) {
        parts.push(`运行超时被中止:超过 ${killed[1]} 分钟仍未结束,已强制结束;今日剩余触发会自动重试未完成的账号`)
    }

    return { text: parts.join('\n'), history }
}

async function main() {
    const args = process.argv.slice(2)
    const dry = args.includes('--dry')
    const file = args.find(arg => !arg.startsWith('--')) ?? 'logs/last-run.log'
    if (!fs.existsSync(file)) {
        console.error(`找不到日志文件: ${file}`)
        process.exitCode = 2
        return
    }

    const status = channelStatus()
    console.log(`通道状态: 企业微信=${status.wecom ? '已配置' : '未配置'}`)

    const { text, history } = buildSummary(fs.readFileSync(file, 'utf8').split(/\r?\n/))
    if (!text) {
        console.log('没有需要推送的内容')
        return
    }

    // --dry:只预览要发送的文本,不入库、不发送(排查"推送里数字看不懂"时用)。
    if (dry) {
        console.log('--- 预览(未发送)---')
        console.log(text)
        return
    }

    if (history.length) recordRun(history)
    const results = await broadcast(text)
    for (const line of results) console.log(line)
}

if (process.argv[1]?.endsWith('notify-run.js')) {
    main().catch(error => {
        console.error(`推送失败:${error?.message ?? error}`)
        process.exitCode = 1
    })
}
