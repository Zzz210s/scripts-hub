// 运行流程里的两类通知:开始提醒(一句话)与跳过提醒。正常跳过只记运行日志,
// 有风险的跳过才推企业微信;都发往 config.webhookFile;dry-run 只预览,不消耗当天的提醒额度。
import path from 'node:path'

import { buildSkipMessage, buildStartMessage, isSilentSkip, shouldNotifyOnce } from './notify-policy.js'
import { sendWecom } from './notify.js'

/** 运行前一条:只说哪个程序开始跑;不再预览挑战与余额,省掉一次联网取数。 */
export async function sendStartNotice({ cwd, config, date, accountName, dryRun, send = sendWecom }) {
    const text = buildStartMessage({ date, accountName })
    return send(text, { webhookFile: path.join(cwd, config.webhookFile), dryRun })
}

/**
 * 跳过一条:正常跳过(已达标 / 同伴在跑 / 安静时段)不推送,只在日志里留一行;
 * 其余原因(内存不足 / 尝试次数用尽 / 临近关机 / 凭据失效 / 统计读不到)照旧,
 * dry-run 或当天首次时才发。
 */
export async function sendSkipNotice({ cwd, config, plan, date, accountName, reason, detail, dryRun, send = sendWecom, notifyOnce = shouldNotifyOnce, log = console.log }) {
    if (isSilentSkip(reason)) {
        // 静音不等于消失:日志里留一行,事后能查到「这次为什么没跑」
        log(`正常跳过,不推送(只记日志):${reason}${detail ? ` · ${detail}` : ''}`)
        return { ok: true, skipped: true, silent: true }
    }
    if (!dryRun && !notifyOnce(path.join(cwd, 'data'), reason, date)) return { ok: true, skipped: true }
    const text = buildSkipMessage({ reason, detail, plan, config, date, accountName })
    return send(text, { webhookFile: path.join(cwd, config.webhookFile), dryRun })
}
