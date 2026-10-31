// 收尾:两处福利 -> 组装并推送日报 -> 落状态与历史。从 run.js 抽出(文件 200 行上限)。
// 输入是会话循环跑完后的现场(ctx);返回值即这次运行的最终结果对象。
import path from 'node:path'

import { sendWecom } from './notify.js'
import { localDay, planDay, windowFromChallenge } from './plan.js'
import { buildReport } from './report.js'
import { activeChallenge } from './challenge.js'
import { balanceRecord, challengeRecord, memberCardRecord, weeklyForReport, weeklyRecord } from './rewards-run.js'
import { appendHistory, recordMinutes, writeState } from './state.js'
import { welfareForReport, welfareRecord } from './welfare-run.js'

export async function finishRun(ctx) {
    const { cwd, now, config, dryRun, accountName, credential, stats, plan, bot, parsed, sessions, stopReason, before, after, creditedNote, planNow, range, state: stateIn, deps } = ctx

    const outcome = bot?.killed ? '被看门狗中止' : (bot?.ok ? '成功' : `失败 · 退出码 ${bot?.exitCode}`)
    // 完整口径只进运行日志与 history.json(history 里另有 credential 与前后分钟数);
    // 消息里只保留「凭据已自动续期」一句,计入异常与读回失败仍作为 alert 进消息
    // 消息里说清这次跑了几个会话(一个会话正常,多个说明是补读)
    const sessionsNote = sessions > 1 ? ` · 本次跑了 ${sessions} 个会话` : ''
    const note = credential.renewed
        ? `凭据已自动续期 · ${credential.changed.join(', ') || '仅刷新有效期'} · ${creditedNote}${sessionsNote}`
        : `${creditedNote}${sessionsNote}`
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

    // 收尾复算也要用挑战真值:否则日报会拿统计口径宣布「已达标」,而挑战其实还差几分钟。
    const activeNow = activeChallenge(challenge)
    const windowNow = windowFromChallenge(activeNow)
    const finishConfig = windowNow ? { ...config, challengeStart: windowNow.start, challengeEndsOn: windowNow.end } : config
    const refreshedPlan = stats.ok
        ? planDay({ now, config: finishConfig, buckets: stats.buckets, todaySeconds: stats.todaySeconds, attempts: stateIn.attempts, challenge: activeNow })
        : plan
    const welfareLine = welfareForReport(welfare, { dataDir: path.join(cwd, 'data'), date: localDay(now) })
    const report = buildReport({ plan: refreshedPlan, run, config, date: localDay(now), accountName, welfare: welfareLine, weekly: weeklyForReport(weekly, { dataDir: path.join(cwd, 'data'), date: localDay(now) }), weeklyStatus: weeklyRecord(weekly), challenge, balance, memberCard })
    const push = await sendWecom(report, { webhookFile: path.join(cwd, config.webhookFile), dryRun })

    // 循环结束后用最终官方进度补记一次 minutes/done(不再累加 attempts —— 每个会话已经计过)
    const state = recordMinutes(stateIn, { minutes: after, targetMinutes: planNow.targetMinutes })
    writeState(state, path.join(cwd, 'data'))

    const nextState = state
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
        // 这次运行内跑了几个会话、为什么停(达标 / 配额用尽 / 底座失败 / 统计读不到)
        sessions,
        stopReason,
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
        sessions,
        stopReason,
        exitCode: after > before ? 0 : 1
    }
}
