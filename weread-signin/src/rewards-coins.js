// 挑战进度与书币余额:与阅读福利共用同一枚 App 凭据,但两步各自独立兜底,
// 任何失败只体现在返回值与日志里,绝不影响本次运行的结果与退出码。
import path from 'node:path'

import { readBalance } from './balance.js'
import { collectChallenge } from './challenge.js'
import { readMemberCard } from './member-card.js'
import { callWithRefresh, credentialsPath, ensureAppToken, tokenPath } from './app-auth.js'
import { redactError } from './welfare-run.js'

const CHALLENGE_LOG_PREFIX = '[CHALLENGE]'
const BALANCE_LOG_PREFIX = '[BALANCE]'
const CARD_LOG_PREFIX = '[CARD]'
const LOG_LIST_LIMIT = 2

/** 历史落盘形状:挑战只留派生字段,失败时 list 为空,不写敏感信息。纯函数,便于钉住落盘格式。 */
export function challengeRecord(challenge) {
    if (!challenge) return null
    return {
        ok: Boolean(challenge.ok),
        reason: challenge.reason ?? null,
        list: (challenge.list ?? []).map(entry => ({
            id: entry.id ?? '',
            isPaid: Boolean(entry.isPaid),
            totalDays: entry.totalDays ?? 0,
            readSeconds: entry.readSeconds ?? 0,
            readDays: entry.readDays ?? 0,
            targetDays: entry.targetDays ?? 0,
            targetSeconds: entry.targetSeconds ?? 0,
            remainDays: entry.remainDays ?? 0,
            canMiss: entry.canMiss ?? 0,
            done: Boolean(entry.done),
            rewardCoin: entry.rewardCoin ?? 0,
            rewardCard: entry.rewardCard ?? 0,
            extraRewardCoin: entry.extraRewardCoin ?? 0,
            extraRewardCard: entry.extraRewardCard ?? 0
        }))
    }
}

/** 历史落盘形状:余额失败给 0,不写敏感信息。纯函数。 */
export function balanceRecord(balance) {
    if (!balance) return null
    return {
        ok: Boolean(balance.ok),
        reason: balance.reason ?? null,
        balance: balance.balance ?? 0,
        giftBalance: balance.giftBalance ?? 0,
        expiryBalance: balance.expiryBalance ?? 0
    }
}

/** 历史落盘形状:体验卡/会员卡剩余天数,失败给 0。纯函数。 */
export function memberCardRecord(memberCard) {
    if (!memberCard) return null
    return {
        ok: Boolean(memberCard.ok),
        reason: memberCard.reason ?? null,
        freeCardDays: memberCard.freeCardDays ?? 0,
        remainDays: memberCard.remainDays ?? 0,
        isPaying: Boolean(memberCard.isPaying)
    }
}

function challengePart(challenge) {
    if (!challenge) return `${CHALLENGE_LOG_PREFIX} skipped (no credentials)`
    if (challenge.ok === false) return `${CHALLENGE_LOG_PREFIX} reason=${challenge.reason}`
    const items = (challenge.list ?? []).slice(0, LOG_LIST_LIMIT)
        .map(entry => `${entry.isPaid ? 'paid' : 'free'} ${entry.readDays}/${entry.targetDays}d remain=${entry.remainDays} miss=${entry.canMiss}`)
    return `${CHALLENGE_LOG_PREFIX} ${items.join(' | ')}`
}

function balancePart(balance) {
    if (!balance) return `${BALANCE_LOG_PREFIX} skipped (no credentials)`
    if (balance.ok === false) return `${BALANCE_LOG_PREFIX} reason=${balance.reason}`
    return `${BALANCE_LOG_PREFIX} balance=${balance.balance} gift=${balance.giftBalance}`
}

function cardPart(memberCard) {
    if (!memberCard) return `${CARD_LOG_PREFIX} skipped (no credentials)`
    if (memberCard.ok === false) return `${CARD_LOG_PREFIX} reason=${memberCard.reason}`
    return `${CARD_LOG_PREFIX} freeCardDays=${memberCard.freeCardDays} remainDays=${memberCard.remainDays}`
}

/** 每个运行周期一行可检索日志:挑战、余额与体验卡的状态。只写派生字段,脱敏且截断。 */
export function challengeLogLine(challenge, balance, memberCard) {
    return `${redactError(challengePart(challenge))} ${redactError(balancePart(balance))} ${redactError(cardPart(memberCard))}`
}

/** 写进运行日志;日志只是旁路,任何写入异常都吞掉。 */
export function logChallenge(challenge, balance, memberCard, write = console.log) {
    try {
        write(challengeLogLine(challenge, balance, memberCard))
    } catch { /* 日志失败不影响流程 */ }
}

/** 挑战、余额与体验卡:共用一枚(可能换新过的)凭据,三步各自兜底。永不抛错。 */
export async function collectChallengeAndBalance({ token, tokenArgs, ensureToken, fetchImpl, readChallenges = collectChallenge, readCoins = readBalance, readCard = readMemberCard }) {
    let active = token
    let challenge = null
    let balance = null
    let memberCard = null
    try {
        const step = await callWithRefresh({ token: active, tokenArgs, ensureToken, fn: t => readChallenges({ token: t, fetchImpl }) })
        active = step.token
        challenge = step.result
    } catch (error) {
        challenge = { ok: false, reason: 'error', list: [], error: error?.message ?? String(error) }
    }
    try {
        const step = await callWithRefresh({ token: active, tokenArgs, ensureToken, fn: t => readCoins({ token: t, fetchImpl }) })
        balance = step.result
    } catch (error) {
        balance = { ok: false, reason: 'error', balance: 0, giftBalance: 0, error: error?.message ?? String(error) }
    }
    try {
        const step = await callWithRefresh({ token: active, tokenArgs, ensureToken, fn: t => readCard({ token: t, fetchImpl }) })
        memberCard = step.result
    } catch (error) {
        memberCard = { ok: false, reason: 'error', freeCardDays: 0, remainDays: 0, error: error?.message ?? String(error) }
    }
    return { challenge, balance, memberCard }
}

/**
 * 日报信号:实时数据优先,取不到或明确失败时逐字段回落历史最后一条。
 * 逐字段判断 —— 实时挑战可读但体验卡瞬时失败时,只回落体验卡,不整段丢。
 * 两个来源都失败的字段保留实时结果,让日报显示失败而不是假装一切正常。
 */
export function pickReportSignals(fresh, last) {
    const pick = key => {
        const real = fresh?.[key] ?? null
        const past = last?.[key] ?? null
        if (real && real.ok !== false) return real
        if (past && past.ok !== false) return past
        return real ?? past
    }
    return { challenge: pick('challenge'), balance: pick('balance'), memberCard: pick('memberCard') }
}

/**
 * 运行前预览挑战、余额与体验卡:自己取一次 App 凭据再查。
 * 纯粹为了提前告知,任何失败(缺凭据 / 联网失败 / 抛错)都吞掉,
 * 统一返回全 null,绝不影响本次运行。
 */
export async function peekChallengeAndBalance({ cwd, config, deps = {} }) {
    const empty = { challenge: null, balance: null, memberCard: null }
    try {
        const ensureToken = deps.ensureAppToken ?? ensureAppToken
        const tokenArgs = {
            curlFile: path.join(cwd, config.curlFile),
            tokenFile: tokenPath(cwd),
            credentialsFile: credentialsPath(cwd)
        }
        const token = await ensureToken(tokenArgs)
        if (!token?.ok) return empty
        return await collectChallengeAndBalance({
            token,
            tokenArgs,
            ensureToken,
            fetchImpl: deps.fetchImpl ?? globalThis.fetch,
            readChallenges: deps.collectChallenge,
            readCoins: deps.readBalance,
            readCard: deps.readMemberCard
        })
    } catch {
        return empty
    }
}
