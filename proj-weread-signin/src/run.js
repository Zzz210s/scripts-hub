// 一次完整运行:读回统计 -> 算今日目标 -> 过守卫 -> 写回目标 -> 调底座跑 -> 再读回 -> 领两处福利 -> 推送日报。
import path from 'node:path'

import { ensureAppToken } from './app-auth.js'
import { ensureCredential, describeCredential } from './auth.js'
import { parseBotResult, runBot } from './bot.js'
import { ensureWindow, loadConfig, patchAccountName, patchTargetDuration } from './config.js'
import { decideLocal, decideRemote } from './guards.js'
import { sendWecom } from './notify.js'
import { buildReport } from './report.js'
import { finishRun } from './run-finish.js'
import { sendSkipNotice, sendStartNotice } from './run-notice.js'
import { localDay, minutesInWindow } from './plan.js'
import { makeLivePlanner } from './plan-live.js'
import { peerBusy } from './peer.js'
import { balanceRecord, challengeRecord, collectRewards, memberCardRecord, readChallengeOnly, weeklyForReport, weeklyRecord } from './rewards-run.js'
import { readStatsWithRetry } from './stats.js'
import { appendHistory, isPaused, readState, recordMinutes, recordRun, writeState } from './state.js'
import { welfareForReport, welfareRecord } from './welfare-run.js'

const QUIET_EXIT = 0

/** 跳过时的统一处理:发一条(同一天同一种原因最多一条)说明,并返回跳过结果。 */
async function skipResult({ cwd, now, config, dryRun, verdict, plan, stats, accountName, credential }) {
    await sendSkipNotice({
        cwd, config, dryRun, date: localDay(now), reason: verdict.reason, detail: verdict.detail, plan, accountName
    })
    return { skipped: true, verdict, plan, stats, credential, exitCode: QUIET_EXIT }
}

export async function runOnce(options = {}) {
    const cwd = options.cwd ?? process.cwd()
    const now = options.now ?? new Date()
    const config = ensureWindow(loadConfig(options.envPath ?? path.join(cwd, '.env')), localDay(now))
    const dryRun = Boolean(options.dryRun)

    // 依赖注入:默认用真实实现,测试传 options.deps 覆盖即可完全离线跑完整流程(不联网、不起 Python)
    const deps = {
        ensureAppToken,
        ensureCredential,
        readStatsWithRetry,
        readChallengeOnly,
        runBot,
        collectRewards,
        ...(options.deps ?? {})
    }

    const state0 = readState(path.join(cwd, 'data'), now)
    let state = state0
    const paused = isPaused(path.join(cwd, 'data'))

    // 错峰:同伴程序在跑就跳过(以后新加的程序都照这个约定接进来)
    const peer = peerBusy(config.busyPeers)

    // 第一步:本地守卫(不联网)。不满足就根本不需要访问网络,省下体检与统计读取的耗时
    const local = decideLocal({
        now, config, state, paused,
        force: Boolean(options.force),
        peerBusy: peer.busy,
        peerDetail: peer.detail
    })
    if (!local.run) {
        return skipResult({ cwd, now, config, dryRun, verdict: local, plan: null, accountName: config.accountName })
    }

    // 第二步:联网检查 —— 凭据体检 + 需要时滚动续期(把新的 wr_skey / wr_rt 落盘,否则会话迟早过期)
    let credential = { ok: true, renewed: false, changed: [] }
    try {
        credential = await deps.ensureCredential({ curlFile: path.join(cwd, config.curlFile) })
    } catch (error) {
        credential = { ok: false, renewed: false, changed: [], check: { reason: error.message } }
    }
    const credentialText = describeCredential(credential)

    // 账号名:优先用官方接口返回的昵称,并同步到底座配置里(日志与通知会显示它)
    const accountName = credential.check?.name || config.accountName
    patchAccountName(path.join(cwd, config.botConfig), accountName)

    let stats = { ok: false, error: '未读取' }
    const first = await deps.readStatsWithRetry(cwd, config)
    if (first.ok) { stats = { ...first.stats, ok: true } } else { stats.error = first.error }

    // 计划必须以挑战接口的 readSeconds 为准:统计口径会多报,2026-10-30 差 11 分钟就是这么丢的。
    const replan = makeLivePlanner({ cwd, config, now, deps, getStats: () => (stats.ok ? stats : null), getAttempts: () => state.attempts })
    const plan = stats.ok ? await replan(stats.todaySeconds) : null

    const remote = decideRemote({ credential: credential.ok, credentialDetail: credentialText, stats, plan })
    if (!remote.run) {
        return skipResult({ cwd, now, config, dryRun, verdict: remote, plan, stats, accountName, credential })
    }

    const before = plan.todayMinutes

    // dry-run 只走体检/规划/守卫并预览推送内容:不真的跑阅读、不写状态、不消耗当天的尝试次数
    if (dryRun) {
        const preview = buildReport({ plan, run: null, config, date: localDay(now), accountName })
        return {
            skipped: true,
            dryRun: true,
            verdict: { run: true, reason: 'dry-run', detail: `将按本次会话 ${plan.runMinutes} 分钟运行 · 区间 ${range.low}-${range.high}` },
            plan,
            stats,
            credential,
            report: preview,
            exitCode: 0
        }
    }

    // 开始提示:一次运行只发一条(循环里的第二个会话不再重复发)
    await sendStartNotice({ cwd, config, date: localDay(now), plan, accountName, dryRun, deps })

    // ── 会话循环 ────────────────────────────────────────────────────────────
    // 为什么要循环:底座一次进程 = 一个会话(src/bot.js),而"今天读完了"要按**官方口径**
    // 判定(plan.todayMinutes 来自只读接口)。以前一次触发只跑一个会话,官方进度差一点时
    // 只能等下一次触发 —— 2026-10-05 用户要求改成「必须达标才停」。
    //
    // 每个会话开始前都按最新官方进度重算目标并写回底座配置,否则第二个会话还会按
    // 第一个会话的目标跑。每跑完一个会话就落一次状态(attempts 递增,它同时是"今天
    // 还能读多久"的口径来源),崩了也不丢。
    const sessionsMax = Math.max(1, config.maxSessionsPerRun ?? 3)
    const budgetMs = Math.max(1, config.runBudgetMinutes ?? 330) * 60000
    const loopStartedAt = Date.now()

    let planNow = plan
    let range = patchTargetDuration(path.join(cwd, config.botConfig), planNow.runMinutes)
    let sessions = 0
    let statsFailures = 0
    let stopReason = ''
    let peerDetail = ''
    let bot = null
    let parsed = null
    let after = before
    let creditedNote = ''

    while (sessions < sessionsMax) {
        sessions += 1
        bot = await deps.runBot({
            python: options.python ?? 'python',
            script: path.join(cwd, config.botScript),
            configFile: config.botConfig,
            timeoutMinutes: config.runTimeoutMinutes,
            cwd,
            curlFile: path.join(cwd, config.curlFile)
        })
        parsed = parseBotResult({ ...bot, logFile: path.join(cwd, 'logs', 'weread.log') })

        const sessionOutcome = bot.killed ? '被看门狗中止' : (bot.ok ? '成功' : `失败 · 退出码 ${bot.exitCode}`)
        state = recordRun(state, { minutes: after, targetMinutes: planNow.targetMinutes, outcome: sessionOutcome, at: new Date() })
        writeState(state, path.join(cwd, 'data'))

        const fresh = await deps.readStatsWithRetry(cwd, config)
        if (fresh.ok) {
            statsFailures = 0
            after = Math.round(fresh.stats.todaySeconds / 60)
            const growth = after - before
            // 官方统计有几秒到几分钟的落库延迟,所以不要求严格等于本次上报值;
            // 但增长不足本次上报的一半就要明说 —— 这才是"假计入"的早期信号。
            const reportedMinutes = parsed.reportedSeconds / 60
            const ratio = reportedMinutes > 0 ? growth / reportedMinutes : 1
            creditedNote = ratio >= 0.5
                ? `官方计入约 ${growth} 分钟`
                : `注意:本次上报 ${reportedMinutes.toFixed(1)} 分钟,官方只增加 ${growth} 分钟 —— 可能未全部计入,或统计仍在延迟`
            stats = { ...fresh.stats, ok: true }
        } else {
            // 查不到官方进度就没法说"达标",连失败两次就停并如实告警
            statsFailures += 1
            creditedNote = `读回失败,本次是否计入未能确认:${fresh.error}`
            if (statsFailures >= 2) { stopReason = 'stats-unavailable'; break }
        }

        // 底座自己失败 / 被看门狗杀掉:不要再刷下一个会话(会白耗时间),如实告警
        if (!bot.ok || bot.killed) { stopReason = 'bot-failed'; break }
        if (stats.ok && after >= planNow.targetMinutes) { stopReason = 'done'; break }

        planNow = stats.ok ? await replan(stats.todaySeconds) : planNow
        if (planNow.runMinutes <= 0) { stopReason = 'done'; break }
        if (Date.now() - loopStartedAt + planNow.runMinutes * 60000 > budgetMs) { stopReason = 'budget'; break }
        // 会话之间:先看同伴有没有起来要跑,有就让路;没有就间隔一会儿继续。
        // 用户要求「不影响其它脚本运行」,所以让路优先于继续读。
        const yieldTo = (deps.peerBusy ?? peerBusy)(config.busyPeers)
        if (yieldTo.busy) { stopReason = 'peer-running'; peerDetail = yieldTo.detail ?? ''; break }
        if (config.sessionGapMinutes > 0) {
            await (deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(config.sessionGapMinutes * 60000)
        }

        range = patchTargetDuration(path.join(cwd, config.botConfig), planNow.runMinutes)
    }
    if (!stopReason) stopReason = 'sessions-exhausted'

    return (deps.finishRun ?? finishRun)({
        cwd, now, config, dryRun, accountName, credential, stats, plan, bot, parsed,
        sessions, stopReason, peerDetail, before, after, creditedNote, planNow, range, state, deps
    })
}

export { minutesInWindow }
export { parseBotOutput, parseBotResult, runBot } from './bot.js'
export { peerBusy } from './peer.js'
