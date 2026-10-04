// 运行结果消息的构建与排版(notify-run.js 的正文全在这里,便于直接单测)。
//
// 排版约定见 docs/notification-convention.md:
//   标题行 / 空行 / 汇总行 / 逐账号行 / 失败段
// 逐账号行按"今日得分"从高到低;低分原因缩进跟在对应账号行后面,不再堆到末尾一大段;
// 不用圆括号,补充说明一律用 · 分隔。
import { explainLowScore, LOW_SCORE_THRESHOLD } from './diagnose.js'
import { lastKnown, readHistory } from './history.js'

const FAILURE_MARKERS = [
    /flow failed for/i,
    /\[ACCOUNT-ERROR\]/,
    /\[CLUSTER-WORKER-ERROR\]/,
    /fatal error:/i,
    // 运行器自己的结论行,以及看门狗强杀 —— 强杀时即使已完成部分账号也不算当天完成
    /=== run finished with FAILURES/,
    /\[WATCHDOG\] run killed after/
]
const KILLED_RE = /\[WATCHDOG\] run killed after (\d+) minutes/
const RUN_END_RE = /\[RUN-END\] Completed all accounts \| accountsProcessed=(\d+) \| pointsGained=(\d+) \| previousBalance=(\d+) \| currentBalance=(\d+) \| runtimeMinutes=([\d.]+)/
const ACCOUNT_END_RE = /\[ACCOUNT-END\] Completed account: (\S+) \| pointsGained=(\d+) \| previousBalance=(\d+) \| currentBalance=(\d+)/
const ACCOUNT_START_RE = /\[ACCOUNT-START\] Starting account: (\S+)/
const ACCOUNT_SKIP_RE = /\[ACCOUNT-SKIP\] Skipped account: (\S+)/

/** 失败行 -> 阶段名,便于一眼看出死在哪一步。 */
const STAGES = [
    [/=== run finished with FAILURES/, '运行器结论'],
    [/\[WATCHDOG\]/, '看门狗'],
    [/\[CLUSTER-WORKER-ERROR\]/i, '进程崩溃'],
    [/\[ACCOUNT-ERROR\]/, '账号异常'],
    [/Browser flow failed for/i, '视觉搜索'],
    [/Mobile flow failed for/i, '主流程'],
    [/fatal error:/i, '致命错误']
]

/** 去掉日志前缀与括号标签,留下人话(失败行会很长,截断到 80 字)。 */
export function shortReason(line) {
    return String(line)
        .replace(/\[[^\]]*\]\s*/g, '')
        .replace(/^(?:MAIN|MOBILE|DESKTOP|APP)\s+/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
}

export function failureStage(line) {
    for (const [re, name] of STAGES) if (re.test(line)) return name
    return '未分类'
}

/** 本地(非 UTC)YYYY-MM-DD,凌晨的补跑不会被算成昨天。 */
export function localDay(date) {
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 去重键:同一份运行结果可能被重复推送(手工补发、重跑同一份日志)。 */
const fingerprint = entry => `${entry.account}|${entry.before}|${entry.balance}|${entry.gained}`

/**
 * 把一份运行日志变成推送文案。
 * @param {string[]} lines 运行日志
 * @param {object} [options]
 * @param {Date} [options.date] 用哪天算"今日"
 * @param {object[]|null} [options.past] 已落盘的历史记录,默认读积分历史;测试传 [] 保证可重复
 * @returns {{ text: string|null, history: object[], marker: object|null }}
 *   text 为 null 表示没什么可说的(当天已跑过 / 日志里没有结论)。
 */
export function buildSummary(lines, { date = new Date(), past = null } = {}) {
    const runEnd = lines
        .map(l => l.match(RUN_END_RE))
        .filter(Boolean)
        .sort((a, b) => Number(b[5]) - Number(a[5]))[0] // 最长的一段 = 整次运行
    const accountEnds = lines.map(l => l.match(ACCOUNT_END_RE)).filter(Boolean)
    const failures = lines.filter(line => FAILURE_MARKERS.some(re => re.test(line)))
    const killed = lines.map(line => line.match(KILLED_RE)).find(Boolean)
    const skipped = lines.some(line => /day \d{4}-\d{2}-\d{2} already handled/.test(line))

    if (skipped) return { text: null, history: [], marker: null }
    if (!runEnd && !failures.length) return { text: null, history: [], marker: null }

    const stamp = localDay(date)

    // 连一条账号记录都没有:只说失败原因与上次累计余额
    if (!runEnd && !accountEnds.length) {
        const reason = killed ? shortReason(killed[0]) : failures.length ? shortReason(failures[0]) : '原因未识别'
        const previous = lastKnown()
        const parts = [`微软积分 · ${stamp} · 运行有失败`, '', `原因:${reason}`]
        if (previous) parts.push(`上次:${previous.day} · 累计 ${previous.balance} 分`)
        return { text: parts.join('\n'), history: [], marker: { day: stamp, status: 'failed', accounts: 0, gained: 0, dayGained: 0, runtimeMinutes: null } }
    }

    // 一次运行每个阶段各报一条 ACCOUNT-END,所以逐账号合计取首末余额差,不能把各条相加
    const perAccount = new Map()
    const history = []
    for (const match of accountEnds) {
        const [, email, gained, before, after] = match
        const entry = perAccount.get(email) ?? { email, before: Number(before), after: Number(after), gained: 0 }
        entry.after = Number(after)
        entry.gained += Number(gained)
        perAccount.set(email, entry)
    }

    let totalGained = 0
    const deltas = new Map()
    for (const entry of perAccount.values()) {
        const delta = Math.max(entry.gained, entry.after - entry.before)
        deltas.set(entry.email, delta)
        totalGained += delta
        history.push({ account: entry.email, gained: delta, before: entry.before, balance: entry.after, day: stamp })
    }

    // 一天可能跑不止一次(失败后重试);逐账号按"今日"合计,否则补跑的推送里
    // 已领完的账号会显示"本次 +0",看上去像今天什么都没拿到(2026-09-25 用户问到过)。
    const seen = new Set()
    const todayRecords = [...(past ?? readHistory()), ...history]
        .filter(entry => entry.day === stamp)
        .filter(entry => { if (seen.has(fingerprint(entry))) return false; seen.add(fingerprint(entry)); return true })
    const runsPerAccount = new Map()
    for (const entry of todayRecords) runsPerAccount.set(entry.account, (runsPerAccount.get(entry.account) ?? 0) + 1)
    const dayGain = account =>
        todayRecords.filter(entry => entry.account === account).reduce((sum, entry) => sum + (Number(entry.gained) || 0), 0)
    const multiRun = [...runsPerAccount.values()].some(count => count > 1)
    const todayTotal = [...new Set(todayRecords.map(entry => entry.account))].reduce((sum, account) => sum + dayGain(account), 0)

    const runtime = runEnd ? Number(runEnd[5]).toFixed(1) : null
    const accountCount = perAccount.size || (runEnd ? runEnd[1] : 0)
    if (!perAccount.size && runEnd) totalGained = Number(runEnd[2])

    const text = [`微软积分 · ${stamp} · ${failures.length ? '运行有失败' : '运行成功'}`, '']
    const summary = [`结果:${accountCount} 个账号`, `本次 +${totalGained} 分`]
    if (multiRun) summary.push(`今日共 +${todayTotal} 分`)
    if (runtime) summary.push(`耗时 ${runtime} 分钟`)
    text.push(summary.join(' · '))

    if (!perAccount.size && runEnd) text.push(`累计 ${runEnd[4]} 分 · 运行前 ${runEnd[3]} 分`)

    const rows = [...perAccount.values()]
        .map(entry => ({ entry, delta: deltas.get(entry.email), day: dayGain(entry.email) }))
        .sort((a, b) => b.day - a.day || b.delta - a.delta)
    for (const { entry, delta, day } of rows) {
        const parts = [`账号 ${entry.email}`]
        if (multiRun) parts.push(`今日 +${day}`)
        parts.push(`本次 +${delta}`, `累计 ${entry.after}`)
        text.push(parts.join(' · '))
        if (delta <= LOW_SCORE_THRESHOLD) {
            const reason = explainLowScore(entry.email, lines)
            if (reason) text.push(`  原因:${reason}`)
        }
    }

    if (failures.length) {
        text.push('', `失败:${failures.length} 条`)
        for (const line of failures.slice(0, 5)) text.push(`  ${failureStage(line)} · ${shortReason(line)}`)
        if (failures.length > 5) text.push(`  另有 ${failures.length - 5} 条`)
    }

    // 开始过但既没结束也没跳过的账号:日志被截断或运行被杀时会漏在这
    const ended = new Set(perAccount.keys())
    const unfinished = [...new Set(lines.map(line => line.match(ACCOUNT_START_RE)?.[1]).filter(Boolean))]
        .filter(account => !ended.has(account) && !lines.some(line => line.match(ACCOUNT_SKIP_RE)?.[1] === account))
    if (unfinished.length) text.push(`未完成:${unfinished.length} 个账号 · ${unfinished.join(' · ')}`)

    if (killed) {
        text.push(`看门狗:超过 ${killed[1]} 分钟仍未结束已强制结束 · 今日剩余触发会自动重试未完成的账号`)
    }

    const marker = {
        day: stamp,
        status: failures.length ? 'failed' : 'ok',
        accounts: Number(accountCount),
        gained: totalGained,
        dayGained: multiRun ? todayTotal : totalGained,
        runtimeMinutes: runtime ? Number(runtime) : null
    }
    return { text: text.join('\n'), history, marker }
}
