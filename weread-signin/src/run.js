// 一次完整运行:读回统计 -> 算今日目标 -> 过守卫 -> 写回目标 -> 调底座跑 -> 再读回 -> 领两处福利 -> 推送日报。
import path from 'node:path'

import { ensureAppToken } from './app-auth.js'
import { ensureCredential, describeCredential } from './auth.js'
import { parseBotResult, runBot } from './bot.js'
import { ensureWindow, loadConfig, patchAccountName, patchTargetDuration } from './config.js'
import { decideLocal, decideRemote } from './guards.js'
import { buildReport, sendWecom } from './notify.js'
import { sendSkipNotice, sendStartNotice } from './run-notice.js'
import { localDay, minutesInWindow, planDay } from './plan.js'
import { peerBusy } from './peer.js'
import { balanceRecord, challengeRecord, collectRewards, memberCardRecord, weeklyForReport, weeklyRecord } from './rewards-run.js'
import { readStatsWithRetry } from './stats.js'
import { appendHistory, isPaused, readState, recordRun, writeState } from './state.js'
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
        runBot,
        collectRewards,
        ...(options.deps ?? {})
    }

    const state = readState(path.join(cwd, 'data'), now)
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

    const plan = stats.ok
        ? planDay({ now, config, buckets: stats.buckets, todaySeconds: stats.todaySeconds, attempts: state.attempts })
        : null

    const remote = decideRemote({ credential: credential.ok, credentialDetail: credentialText, stats, plan })
    if (!remote.run) {
        return skipResult({ cwd, now, config, dryRun, verdict: remote, plan, stats, accountName, credential })
    }

    const range = patchTargetDuration(path.join(cwd, config.botConfig), plan.runMinutes)

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

    const before = plan.todayMinutes
    // 开始提示:一次运行只发一条;运行前也预览挑战与余额,拿不到就不显示
    await sendStartNotice({ cwd, config, date: localDay(now), plan, accountName, dryRun, deps })

    const bot = await deps.runBot({
        python: options.python ?? 'python',
        script: path.join(cwd, config.botScript),
        configFile: config.botConfig,
        timeoutMinutes: config.runTimeoutMinutes,
        cwd,
        curlFile: path.join(cwd, config.curlFile)
    })
    const parsed = parseBotResult({ ...bot, logFile: path.join(cwd, 'logs', 'weread.log') })

    let after = before
    let creditedNote = ''
    const fresh = await deps.readStatsWithRetry(cwd, config)
    if (fresh.ok) {
        after = Math.round(fresh.stats.todaySeconds / 60)
        const growth = after - before
        // 官方统计有几秒到几分钟的落库延迟,所以不要求严格等于本次上报值;
        // 但增长不足本次上报的一半就要明说 —— 这才是"假计入"的早期信号。
        const reportedMinutes = parsed.reportedSeconds / 60
        const ratio = reportedMinutes > 0 ? growth / reportedMinutes : 1
        if (ratio >= 0.5) {
            creditedNote = `官方计入约 ${growth} 分钟`
        } else {
            creditedNote = `注意:本次上报 ${reportedMinutes.toFixed(1)} 分钟,官方只增加 ${growth} 分钟 —— 可能未全部计入,或统计仍在延迟`
        }
        stats = { ...fresh.stats, ok: true }
    } else {
        creditedNote = `读回失败,本次是否计入未能确认:${fresh.error}`
    }

    const outcome = bot.killed ? '被看门狗中止' : (bot.ok ? '成功' : `失败 · 退出码 ${bot.exitCode}`)
    // 完整口径只进运行日志与 history.json(history 里另有 credential 与前后分钟数);
    // 消息里只保留「凭据已自动续期」一句,计入异常与读回失败仍作为 alert 进消息
    const note = credential.renewed
        ? `凭据已自动续期 · ${credential.changed.join(', ') || '仅刷新有效期'} · ${creditedNote}`
        : creditedNote
    const run = {
        ...parsed,
        ok: bot.ok,
        outcome,
        note,
        renewal: credential.renewed ? '凭据已自动续期' : '',
        alert: /^注意:|^读回失败/.test(creditedNote) ? creditedNote : ''
    }

    // 两处福利:阅读器福利书币 + 阅读时长福利(共用一枚 App 凭据);失败只记进历史与日报
    const { reader: welfare, weekly, challenge, balance, memberCard } = await deps.collectRewards({ cwd, config, bot, deps })

    const refreshedPlan = stats.ok
        ? planDay({ now, config, buckets: stats.buckets, todaySeconds: stats.todaySeconds, attempts: state.attempts })
        : plan
    const welfareLine = welfareForReport(welfare, { dataDir: path.join(cwd, 'data'), date: localDay(now) })
    const report = buildReport({ plan: refreshedPlan, run, config, date: localDay(now), accountName, welfare: welfareLine, weekly: weeklyForReport(weekly, { dataDir: path.join(cwd, 'data'), date: localDay(now) }), weeklyStatus: weeklyRecord(weekly), challenge, balance, memberCard })
    const push = await sendWecom(report, { webhookFile: path.join(cwd, config.webhookFile), dryRun })

    const nextState = recordRun(state, { minutes: after, targetMinutes: refreshedPlan.targetMinutes, outcome, at: now })
    writeState(nextState, path.join(cwd, 'data'))
    appendHistory({
        at: now.toISOString(),
        targetMinutes: refreshedPlan.targetMinutes,
        range,
        beforeMinutes: before,
        afterMinutes: after,
        botSeconds: bot.seconds,
        reportedSeconds: parsed.reportedSeconds,
        requests: parsed.requests,
        failures: parsed.failures,
        outcome,
        credited: after > before,
        credential: { ok: credential.ok, renewed: credential.renewed, changed: credential.changed },
        welfare: welfareRecord(welfare),
        weekly: weeklyRecord(weekly),
        challenge: challengeRecord(challenge), balance: balanceRecord(balance), memberCard: memberCardRecord(memberCard)
    }, path.join(cwd, 'data'))

    return {
        skipped: false,
        plan: refreshedPlan,
        run,
        report,
        push,
        range,
        welfare,
        credential,
        accountName,
        beforeMinutes: before,
        afterMinutes: after,
        credited: after > before,
        exitCode: after > before ? 0 : 1
    }
}

export { minutesInWindow }
export { parseBotOutput, parseBotResult, runBot } from './bot.js'
export { peerBusy } from './peer.js'
