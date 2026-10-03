// 运行流程里的两类通知:开始提醒(一句话)与跳过提醒(同一天同一种原因只发一次)。
// 都发往 config.webhookFile;dry-run 只预览,不消耗当天的提醒额度。
import path from 'node:path'

import { buildSkipMessage, buildStartMessage, shouldNotifyOnce } from './notify-policy.js'
import { sendWecom } from './notify.js'

/** 运行前一条:只说哪个程序开始跑;不再预览挑战与余额,省掉一次联网取数。 */
export async function sendStartNotice({ cwd, config, date, accountName, dryRun, send = sendWecom }) {
    const text = buildStartMessage({ date, accountName })
    return send(text, { webhookFile: path.join(cwd, config.webhookFile), dryRun })
}

/** 跳过一条:dry-run 或当天首次时才发。 */
export async function sendSkipNotice({ cwd, config, plan, date, accountName, reason, detail, dryRun, send = sendWecom, notifyOnce = shouldNotifyOnce }) {
    if (!dryRun && !notifyOnce(path.join(cwd, 'data'), reason, date)) return { ok: true, skipped: true }
    const text = buildSkipMessage({ reason, detail, plan, config, date, accountName })
    return send(text, { webhookFile: path.join(cwd, config.webhookFile), dryRun })
}
