// 命令行入口:plan / run / status / verify / pause / resume
import path from 'node:path'

import { describeCredential, ensureCredential, renewCookie } from './auth.js'
import { ensureWindow, loadConfig } from './config.js'
import { buildReport, sendWecom } from './notify.js'
import { minutesToShutdown } from './guards.js'
import { loadApiKey, minutes, readStats, summarize } from './stats.js'
import { localDay, planDay } from './plan.js'
import { peekChallengeAndBalance, pickReportSignals } from './rewards-coins.js'
import { runOnce } from './run.js'
import { readHistory, readState, setPaused } from './state.js'

export function parseArgs(argv) {
    const rest = argv.slice(2)
    const command = ['plan', 'run', 'status', 'verify', 'pause', 'resume', 'auth', 'report'].includes(rest[0]) ? rest[0] : 'status'
    return { command, dry: rest.includes('--dry'), force: rest.includes('--force'), json: rest.includes('--json') }
}

async function readStatsOrThrow(cwd, config, deps = {}) {
    const apiKey = (deps.loadApiKey ?? loadApiKey)(path.join(cwd, config.apiKeyFile))
    return (deps.readStats ?? readStats)({ apiKey, mode: 'monthly' })
}

function printPlan(plan, config) {
    console.log(`日期 ${plan.today}`)
    console.log(`已读 ${plan.minutesSoFar} 分钟 / 需要 ${config.requiredMinutes} 分钟;剩余 ${plan.remainingMinutes} 分钟 / ${plan.remainingDays} 天`)
    console.log(`今日目标 ${plan.targetMinutes} 分钟(已完成 ${plan.todayMinutes}),可失败 ${plan.failableDays} 天${plan.emergency ? ' [紧急模式]' : ''}`)
    console.log(`今日窗口 ${plan.windowMinutes} 分钟${plan.windowCapped ? '(目标已按窗口下调)' : ''};本次会话 ${plan.runMinutes} 分钟`)
    console.log(`段落计划:${plan.sections.length ? plan.sections.map(s => `${s.minutes} 分钟`).join(' + ') : '(今天不用跑)'}`)
    if (config.windowAssumed) console.log('提醒:挑战起止日期未配置,当前按"今天起 30 天"计算')
}

export async function main(argv, deps = {}) {
    const cwd = deps.cwd ?? process.cwd()
    const now = deps.now ?? new Date()
    const { command, dry, force } = parseArgs(argv)
    const config = ensureWindow(loadConfig(path.join(cwd, '.env')), localDay(now))

    if (command === 'pause' || command === 'resume') {
        setPaused(command === 'pause', path.join(cwd, 'data'))
        console.log(command === 'pause' ? '已暂停:后续触发都会跳过' : '已恢复')
        return 0
    }

    if (command === 'auth') {
        const curlFile = path.join(cwd, config.curlFile)
        if (parseArgs(argv).force) {
            // 强制续期:把服务端的有效期窗口往后推(值通常不变,但窗口会刷新)
            const renewal = await renewCookie({ curlFile })
            console.log(renewal.ok ? `已请求续期(${renewal.changed.join(', ') || '有效期已刷新,值未变'})` : `续期失败:${renewal.tried.join(' / ')}`)
        }
        const result = await ensureCredential({ curlFile })
        console.log(describeCredential(result))
        if (result.ok) console.log(`cURL 文件:${curlFile}`)
        return result.ok ? 0 : 1
    }

    if (command === 'report') {
        const stats = await readStatsOrThrow(cwd, config, deps)
        const plan = planDay({ now, config, buckets: stats.buckets, todaySeconds: stats.todaySeconds })
        const history = readHistory(path.join(cwd, 'data'))
        const last = history.at(-1) ?? null
        // 挑战/余额/体验卡先实时取一次:历史可能是旧版本写的、缺字段;取数失败逐字段回落历史
        const fresh = await (deps.peekChallengeAndBalance ?? peekChallengeAndBalance)({ cwd, config, deps })
        const text = buildReport({
            plan,
            run: last ? { ok: true, reportedSeconds: last.reportedSeconds ?? 0, requests: last.requests ?? 0, outcome: last.outcome ?? '成功', renewal: last.credential?.renewed ? '凭据已自动续期' : '' } : null,
            config,
            date: plan.today,
            accountName: config.accountName,
            // 实时优先、历史兜底;本周档位与阅读器书币仍取最近一次运行落盘的口径
            data: {
                ...pickReportSignals(fresh, last),
                weeklyStatus: last?.weekly ?? null,
                welfare: last?.welfare ?? null
            }
        })
        console.log(text)
        const push = await sendWecom(text, { webhookFile: path.join(cwd, config.webhookFile), dryRun: dry })
        console.log(`企业微信:${push.ok ? (dry ? '未发送(dry-run)' : '已推送') : `失败(${push.error})`}`)
        return push.ok ? 0 : 1
    }

    if (command === 'verify') {
        const stats = await readStatsOrThrow(cwd, config, deps)
        console.log(summarize(stats))
        console.log(`最近 3 天:${stats.buckets.slice(-3).map(b => `${b.day} ${minutes(b.seconds)} 分钟`).join(' | ')}`)
        return 0
    }
    if (command === 'status') {
        const state = readState(path.join(cwd, 'data'), now)
        console.log(`状态(${state.date}):今日 ${state.todayMinutes} 分钟 / 目标 ${state.targetMinutes},尝试 ${state.attempts} 次,${state.done ? '已达标' : '未达标'}`)
        const history = readHistory(path.join(cwd, 'data')).slice(-5)
        for (const row of history) {
            console.log(`  ${row.at.slice(0, 16)} 目标 ${row.targetMinutes} 分钟 ${row.beforeMinutes}->${row.afterMinutes} ${row.outcome}${row.credited ? '' : '(未计入)'}`)
        }
        try {
            const stats = await readStatsOrThrow(cwd, config, deps)
            console.log(`官方:${summarize(stats)}`)
        } catch (error) {
            console.log(`官方统计读取失败:${error.message}`)
        }
        console.log(`距 ${config.shutdownTime} 关机还有 ${minutesToShutdown(now, config.shutdownTime)} 分钟`)
        return 0
    }

    if (command === 'plan') {
        const stats = await readStatsOrThrow(cwd, config, deps)
        printPlan(planDay({ now, config, buckets: stats.buckets, todaySeconds: stats.todaySeconds }), config)
        return 0
    }

    const result = await runOnce({ cwd, now, dryRun: dry, force })
    if (result.dryRun) {
        console.log(`预览(dry-run,未真正运行):${result.verdict.detail}`)
        console.log(result.report)
        console.log(`企业微信:未发送(dry-run)`)
        return 0
    }
    if (result.skipped) {
        console.log(`本次跳过:${result.verdict.reason} ${result.verdict.detail ?? ''}`)
        return result.exitCode ?? 0
    }
    console.log(`运行结束:${result.run.outcome} | 官方今日 ${result.plan.todayMinutes} 分钟(${result.beforeMinutes} -> ${result.afterMinutes})`)
    // 完整口径(续期换了哪些字段 / 官方计入多少分钟)只进运行日志,不进推送消息
    if (result.run.note) console.log(`口径:${result.run.note}`)
    console.log(result.report)
    console.log(`企业微信:${result.push.ok ? '已推送' : `失败(${result.push.error})`}`)
    return result.exitCode
}
