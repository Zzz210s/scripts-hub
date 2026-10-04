// 把福利书币接进运行流程的一段独立逻辑;任何失败都不影响本次运行的结果与退出码。
import path from 'node:path'

import { callWithRefresh, credentialsPath, ensureAppToken, rawTokenExpired, tokenPath } from './app-auth.js'
import { shouldNotifyOnce } from './notify-policy.js'
import { claimIfAvailable } from './welfare.js'

/**
 * 会话结束后顺带领一次福利书币(读着书才会出现的入口)。
 * 凭据拿不到或中途出错都只体现在返回值里,不抛错。
 * 拿不到凭据时返回 `{ ok: true, claimed: false, reason: 'no-credentials', error }`
 * —— ok 保持 true 是为了不触发告警,原因与错误留在历史与日志里。
 */
export function isTokenExpired(result) {
    return rawTokenExpired(result?.queryRaw)
}

export async function claimWelfareOnce({ cwd, config, bot, claim = claimIfAvailable, ensureToken = ensureAppToken }) {
    const tokenArgs = {
        curlFile: path.join(cwd, config.curlFile),
        tokenFile: tokenPath(cwd),
        credentialsFile: credentialsPath(cwd)
    }
    try {
        const token = await ensureToken(tokenArgs)
        if (!token.ok) {
            // 不打扰:ok 保持 true(与「无可领」一样不进告警),但把原因与错误留在历史与日志里。
            return { ok: true, claimed: false, coin: 0, key: '', reason: 'no-credentials', error: token.error }
        }
        const args = { bookId: bot.bookId ?? '', chapterUid: bot.chapterUid ?? 0 }
        const { result } = await callWithRefresh({ token, tokenArgs, ensureToken, fn: t => claim({ ...args, token: t }), rawOf: r => r?.queryRaw })
        return result
    } catch (error) {
        return { ok: false, claimed: false, reason: 'error', error: error.message }
    }
}

/**
 * 包一层再调用:注入进来的领取函数可能直接抛错,而福利这一步绝不能影响本次运行的结果与退出码,
 * 所以任何异常都在这里收敛成结果对象(形状与 claimWelfareOnce 的兜底一致)。
 */
export async function welfareSafely(claim = claimWelfareOnce, args) {
    try {
        return await claim(args)
    } catch (error) {
        return { ok: false, claimed: false, reason: 'error', error: error.message }
    }
}

/**
 * 历史落盘形状:字段固定下来,没结果时给 null。纯函数,便于钉住落盘格式。
 */
export function welfareRecord(welfare) {
    if (!welfare) return null
    return {
        coin: welfare.coin ?? 0,
        key: welfare.key ?? '',
        claimed: Boolean(welfare.claimed),
        reason: welfare.reason ?? '',
        verified: Boolean(welfare.verified),
        verifyOk: Boolean(welfare.verifyOk)
    }
}

const WELFARE_LOG_PREFIX = '[WELFARE]'
const ERROR_PREVIEW_CHARS = 80

/** 换取凭据失败时日志里会带上服务端原话,先把 token / cookie 类片段抹掉再截断。 */
export function redactError(text) {
    return String(text ?? '')
        .replace(/(accessToken"?\s*[:=]\s*"?)[^"'&,\s;}]+/gi, '$1****')
        .replace(/(refreshToken"?\s*[:=]\s*"?)[^"'&,\s;}]+/gi, '$1****')
        .replace(/(wr_skey=)[^;'"\s]+/gi, '$1****')
        .replace(/(wr_rt=)[^;'"\s]+/gi, '$1****')
        .replace(/(key=)[A-Za-z0-9-]{6,}/g, '$1****')
        .slice(0, ERROR_PREVIEW_CHARS)
}

/**
 * 每个运行周期一行可检索的运行日志:查询有没有发生、结果是什么。
 * 只写派生字段(reason/coin/claimed/verified),不带 cookie / token / 服务端 key / webhook / 账号;
 * 拿不到凭据时带上换取失败的原因(已脱敏、截断),让日志能自解释。
 */
export function welfareLogLine(welfare) {
    if (!welfare) return `${WELFARE_LOG_PREFIX} 跳过:未拿到 App 凭据,本次不查询 reason=no-credentials coin=0 claimed=false verified=false`
    const coin = Number(welfare.coin)
    const line = `${WELFARE_LOG_PREFIX} reason=${welfare.reason || 'unknown'} coin=${Number.isFinite(coin) ? coin : 0} claimed=${Boolean(welfare.claimed)} verified=${Boolean(welfare.verified)}`
    if (welfare.reason === 'no-credentials' && welfare.error) {
        return `${line} error=${redactError(welfare.error)}`
    }
    return line
}

/**
 * 写进运行日志(stdout 由 run-daily.bat 重定向到 logs/last-run.log)。
 * 日志只是旁路,任何写入异常都在这里吞掉 —— 绝不能影响本次运行的结果与退出码。
 */
export function logWelfare(welfare, write = console.log) {
    try {
        write(welfareLogLine(welfare))
    } catch { /* 日志失败不算运行失败 */ }
    return welfare
}

/**
 * 决定日报要看到的福利结果:领取失败要通知,但受"每天一条"额度限制(与跳过类提醒共用),
 * 额度用完就把它当成正常结果(不出现那一行)。query-failed 属瞬时网络问题,不打扰。
 */
export function welfareForReport(welfare, { dataDir, date, notifyOnce = shouldNotifyOnce }) {
    if (!welfare) return welfare
    const failed = welfare.ok === false && welfare.reason !== 'query-failed'
    if (failed && !notifyOnce(dataDir, 'welfare-claim-failed', date)) return { ...welfare, ok: true }
    return welfare
}
