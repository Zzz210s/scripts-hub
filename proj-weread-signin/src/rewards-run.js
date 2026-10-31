// 两处福利的收口:阅读器福利书币 + 阅读时长福利。
// 共用一枚 App 凭据;任何失败都只体现在返回值里,绝不影响运行结果与退出码。
import path from 'node:path'

import { callWithRefresh, credentialsPath, ensureAppToken, tokenPath } from './app-auth.js'
import { shouldNotifyOnce } from './notify-policy.js'
import { collectChallenge } from './challenge.js'
import { collectChallengeAndBalance, logChallenge } from './rewards-coins.js'
import { collectWeekly } from './weekly.js'
import { verifyWeekly } from './weekly-verify.js'
import { claimWelfareOnce, logWelfare, redactError, welfareSafely } from './welfare-run.js'

export { balanceRecord, challengeLogLine, challengeRecord, logChallenge, memberCardRecord } from './rewards-coins.js'

/**
 * 只读一次挑战详情,供计划层当作进度真值。绝不抛:失败给 `{ ok:false }`,
 * 调用方按「没有挑战数据」回落到统计口径。
 */
export async function readChallengeOnly({ cwd, config, deps = {} }) {
    const ensureToken = deps.ensureAppToken ?? ensureAppToken
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch
    const readChallenges = deps.collectChallenge ?? collectChallenge
    const tokenArgs = {
        curlFile: path.join(cwd, config.curlFile),
        tokenFile: tokenPath(cwd),
        credentialsFile: credentialsPath(cwd)
    }
    try {
        const token = await ensureToken(tokenArgs)
        if (!token.ok) return { ok: false, reason: 'no-credentials', list: [] }
        const step = await callWithRefresh({ token, tokenArgs, ensureToken, fn: t => readChallenges({ token: t, fetchImpl }) })
        return step.result ?? { ok: false, reason: 'empty', list: [] }
    } catch (error) {
        return { ok: false, reason: 'error', list: [], error: error?.message ?? String(error) }
    }
}

const WEEKLY_LOG_PREFIX = '[WEEKLY]'

/** 历史落盘形状:字段固定下来,没结果时给 null。纯函数,便于钉住落盘格式。 */
export function weeklyRecord(weekly) {
    if (!weekly) return null
    // 自证结果必须进历史:否则事后无法判断当时是「没领到」还是「查早了」(E4)
    const claimed = (weekly.claimed ?? []).map(item => ({ ...item, verified: item.verified ?? null, via: item.via ?? null }))
    return {
        // ok/reason 带上:否则「查询失败」「没凭据」「确实没档位可领」在历史里完全同形,事后无法排查
        ok: Boolean(weekly.ok),
        reason: weekly.reason ?? null,
        readingSeconds: weekly.readingSeconds ?? 0,
        readingDays: weekly.readingDays ?? 0,
        tiers: weekly.tiers ?? { total: 0, claimed: 0, unreached: 0, claimable: 0 },
        claimable: weekly.claimable ?? 0,
        claimed,
        unverified: claimed.filter(item => item.verified === false).map(item => item.levelId),
        alreadyClaimed: weekly.alreadyClaimed ?? [],
        failed: weekly.failed ?? []
    }
}

/**
 * 决定日报要看到的阅读时长福利:领到给一份,真失败给一份(受"每天一条"额度限制),其余不给。
 * `alreadyClaimed`(-2664)不算失败,所以既不出「领取」也不出「失败」。
 */
export function weeklyForReport(weekly, { dataDir, date, notifyOnce = shouldNotifyOnce } = {}) {
    if (!weekly) return null
    const claimed = weekly.claimed ?? []
    const failed = weekly.failed ?? []
    if (!failed.length) return claimed.length ? { claimed } : null
    // 有真失败:即使同一批也领到了,失败也要报(否则日报只报喜,且下面这行会变成死代码)。
    // 失败行照样吃「每天一条」额度;额度判断自身出错(例如调用方漏传 dataDir)不该挡住日报。
    let allowed = true
    try {
        allowed = Boolean(notifyOnce(dataDir, 'weekly-claim-failed', date))
    } catch {
        allowed = true
    }
    if (!allowed) return claimed.length ? { claimed } : null
    return { claimed, failed }
}

/** 逐档自证标记:verified 未置位的是旧数据,什么都不打(不臆断)。 */
function claimLabel(item) {
    const mark = item.verified === true ? ':verified' : item.verified === false ? ':unverified' : ''
    return `${item.levelDesc}:${item.choiceType === 2 ? 'coin' : 'card'}x${item.awardNum}${mark}`
}

/** 每个运行周期一行可检索的日志:只带档位描述与状态,不带 token / cookie / 账号。 */
export function weeklyLogLine(weekly) {
    if (!weekly) return `${WEEKLY_LOG_PREFIX} skipped (no credentials)`
    if (weekly.ok === false) return `${WEEKLY_LOG_PREFIX} reason=${weekly.reason}`
    // 拿不到凭据时把原因与(脱敏、截断后的)错误写出来,让日志能自解释
    if (weekly.reason === 'no-credentials' && weekly.error) {
        return `${WEEKLY_LOG_PREFIX} reason=no-credentials error=${redactError(weekly.error)}`
    }
    const claimed = weekly.claimed ?? []
    const claimText = claimed.map(claimLabel).join(',')
    const failed = (weekly.failed ?? []).map(f => `${f.levelDesc}:${f.errcode}`).join(',')
    const unverified = claimed.filter(c => c.verified === false).map(c => c.levelDesc).join(',')
    const via = claimed.filter(c => c.via).map(c => `${c.levelDesc}:${c.via}`).join(',')
    return `${WEEKLY_LOG_PREFIX} read=${weekly.readingSeconds}s days=${weekly.readingDays} claimable=${weekly.claimable} claimed=[${claimText}] failed=[${failed}] unverified=[${unverified}] via=[${via}]`
}

/** 写进运行日志(stdout 由 run-daily.bat 重定向到 logs/last-run.log)。日志只是旁路,异常吞掉。 */
export function logWeekly(weekly, write = console.log) {
    try {
        write(weeklyLogLine(weekly))
    } catch { /* 日志失败不影响流程 */ }
    return weekly
}

/** 拿一次 App 凭据,跑完两处福利。阅读时长福利这一步独立兜底,失败不影响阅读器福利。 */
export async function collectRewards({ cwd, config, bot, deps = {} }) {
    const ensureToken = deps.ensureAppToken ?? ensureAppToken
    const claimReader = deps.claimWelfareOnce ?? claimWelfareOnce
    const claimWeeklyOnce = deps.collectWeekly ?? collectWeekly
    // 显式默认到 globalThis.fetch:传 undefined 会覆盖 weekly.js 里的默认值,自证会静默失效
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch
    const verifyDeps = {
        query: deps.queryWeekly, reclaim: deps.claimWeekly, sleep: deps.sleep,
        attempts: deps.verifyAttempts, delayMs: deps.verifyDelayMs
    }

    const tokenArgs = {
        curlFile: path.join(cwd, config.curlFile),
        tokenFile: tokenPath(cwd),
        credentialsFile: credentialsPath(cwd)
    }

    const reader = await welfareSafely(claimReader, { cwd, config, bot, ensureToken })
    logWelfare(reader)

    let weekly = null
    let challenge = null
    let balance = null
    let memberCard = null
    try {
        const token = await ensureToken(tokenArgs)
        if (token.ok) {
            // 失效就换一枚重试一次(共用实现);自证必须用换过的那枚 token,否则会再撞 401 而静默跳过
            const weeklyRun = await callWithRefresh({ token, tokenArgs, ensureToken, fn: t => claimWeeklyOnce({ token: t, fetchImpl }) })
            weekly = weeklyRun.result
            weekly = await verifyWeekly({ token: weeklyRun.token, fetchImpl }, weekly, verifyDeps)

            // 挑战、余额与体验卡共用这枚(可能已换新的)凭据,三步各自兜底,失败只落日志与历史
            const coins = await collectChallengeAndBalance({
                token: weeklyRun.token, tokenArgs, ensureToken, fetchImpl,
                readChallenges: deps.collectChallenge, readCoins: deps.readBalance, readCard: deps.readMemberCard
            })
            challenge = coins.challenge
            balance = coins.balance
            memberCard = coins.memberCard
        } else {
            weekly = { ok: true, readingSeconds: 0, readingDays: 0, claimable: 0, claimed: [], alreadyClaimed: [], failed: [], reason: 'no-credentials', error: token.error }
        }
    } catch (error) {
        // ensureAppToken 在缺 secrets/* 文件时是 throw(ENOENT / 中文缺失提示),
        // 生产上高频场景落在这里 —— 归成 no-credentials 才与真实路径一致。
        const message = error?.message ?? String(error)
        const noCredentials = /ENOENT|缺少/.test(message)
        weekly = {
            ok: noCredentials,
            reason: noCredentials ? 'no-credentials' : 'error',
            readingSeconds: 0, readingDays: 0, claimable: 0,
            claimed: [], alreadyClaimed: [], failed: [], error: message
        }
    }
    logWeekly(weekly)
    logChallenge(challenge, balance, memberCard)

    return { reader, weekly, challenge, balance, memberCard }
}
