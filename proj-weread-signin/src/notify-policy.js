// 通知策略:把"为什么不跑"翻译成人话,并限制同类提醒的频率。
//
// 排版约定见 scripts-hub/docs/notification-convention.md:
//   开始消息一行:名称 · 账号 · 日期 · 开始自动阅读,细节交给运行日志与结果消息;
//   跳过类 标题行 / 空行 / 原因 / 后续 / 你需要做什么;
//   人工处理类 标题行 / 空行 / 请你 / 原因 / 不处理的后果;分隔符统一 · ,禁止圆括号。
//
// 规则(2026-10-02 用户反馈后定):
//   * 跳过类提醒:同一天、同一种原因,最多一条 —— 避免机器一整天反复触发时刷屏
//   * 文案必须回答三个问题:发生了什么 / 为什么 / 接下来会怎样
//   * 真正需要人工处理的情况不受频率限制,每次都要说
//   * 2026-10-03:skip 与 action 曾长得几乎一样,现在标题与正文都分开写
//   * 2026-10-04:正常跳过(已达标 / 同伴在跑 / 安静时段)不再推送,只写运行日志
import fs from 'node:fs'
import path from 'node:path'

import { writeJsonAtomic } from './atomic.js'

const ALWAYS_NOTIFY = new Set(['credential-invalid', 'stats-unavailable'])
// 不处理就一直不跑:凭据失效、读不到官方统计。其余原因下次触发都会自动重试
const ACTION_REASONS = new Set(['credential-invalid', 'stats-unavailable'])
// 2026-10-04 用户要求:企业微信只收「需要你处理」的提醒,「正常跳过」一律只写运行日志。
// 因此除 ACTION_REASONS 之外的任何原因都静默 —— 不再维护"哪些正常跳过要推"的白名单,
// 也就不会再出现「今天已达标」「同伴在跑」「安静时段」「内存不足」「次数用尽」这类推送。
const SILENT_SKIP_REASONS = new Set(['done', 'peer-running', 'quiet-hours'])   // 仅用于文档与测试引用

/** 这条跳过是否只记运行日志、不推企业微信:只有"需要你处理"的才推。 */
export function isSilentSkip(reason) {
    return !ACTION_REASONS.has(reason)
}

export function buildSkipMessage({ reason, detail, plan, config, date, accountName }) {
    const action = ACTION_REASONS.has(reason)
    const head = `微信读书签到 · ${accountName ?? '微信读书'} · ${date} · ${action ? '需要你处理' : '正常跳过'}`
    // 标题行后留空行,与开始/结果消息及微软积分那边一致
    const lines = [head, '']
    switch (reason) {
        case 'peer-running':
            lines.push(`原因:${detail ?? '另一个自动化程序正在运行'}`)
            lines.push('后续:约 1 小时后或下次登录触发时自动重试 · 两个程序同时跑会抢内存和网络,所以错峰让路')
            lines.push('你需要做什么:不需要')
            break
        case 'done':
            lines.push(`原因:今天已经达标 · 官方统计 ${plan?.todayMinutes ?? '?'} 分钟 · 目标 ${plan?.targetMinutes ?? '?'} 分钟`)
            lines.push('后续:今天不再自动阅读 · 明天按新一天重新开始')
            lines.push('你需要做什么:不需要')
            break
        case 'quiet-hours':
            lines.push(`原因:现在是安静时段 · ${config?.quietStart}-${config?.quietEnd}`)
            lines.push('后续:时段结束后下一次触发会自动开始')
            lines.push('你需要做什么:不需要')
            break
        case 'before-shutdown':
            lines.push(`原因:距 ${config?.shutdownTime} 关机不足 ${config?.shutdownGuardMinutes} 分钟`)
            lines.push('后续:等下一次机会 · 现在启动会跑到一半被关机掐断')
            lines.push('你需要做什么:不需要')
            break
        case 'attempts-exhausted':
            lines.push('原因:今天已经尝试多次仍未达标')
            lines.push('后续:等明天的新一天再继续 · 自动进行')
            lines.push('你需要做什么:不需要')
            break
        case 'paused':
            lines.push('原因:已手动暂停 · 存在 data/paused')
            lines.push('后续:恢复之前每次触发都会跳过')
            lines.push('你需要做什么:想继续就跑 node src/index.js resume')
            break
        case 'stats-unavailable':
            lines.push('请你:先确认网络正常 · 再检查 secrets/weread-api-key.txt 里的 API Key 是否还有效 · 必要时重新抓一次 read 请求的 cURL 覆盖 secrets/read-request.curl')
            lines.push(`原因:读不到官方阅读统计 · ${detail ?? '未知'}`)
            lines.push('不处理的后果:判断不了是否达标就不会开跑,之后每次触发都会跳过,当天可能一分未读')
            break
        case 'low-memory':
            lines.push(`原因:可用内存不足 · ${detail ?? '未知'}`)
            lines.push('后续:硬跑会拖成几小时 · 等内存空出后的下一次触发自动补跑')
            lines.push('你需要做什么:不需要')
            break
        case 'credential-invalid':
            lines.push('请你:重新抓一次 read 请求的 cURL,覆盖 secrets/read-request.curl')
            lines.push(`原因:登录凭据失效,自动续期也没成功 · ${detail ?? '未知'}`)
            lines.push('不处理的后果:只要没换新凭据,之后每次触发都会跳过,当天不会再自动阅读')
            break
        default:
            lines.push(`原因:${reason}${detail ? ` · ${detail}` : ''}`)
            lines.push('后续:下一次触发会重试')
            lines.push('你需要做什么:不需要')
    }
    // 进度行只给「静默跳过」用(它整条文案进运行日志,事后能看出当天读了多少)。
    // 「需要你处理」不附这行(2026-10-04 用户要求):那种消息是让人去换凭据/查网络,
    // 今日已读多少与要做的事无关,多一行只是噪音。
    if (plan && !action) lines.push(`今日已读 ${plan.todayMinutes ?? 0} / ${plan.targetMinutes ?? 0} 分钟 · 官方口径 · 含你自己的阅读`)
    return lines.join('\n')
}

/** 运行开始提示:一句话说明哪个程序开始跑;目标、分段、挑战与福利都交给结果消息与运行日志。 */
export function buildStartMessage({ date, accountName }) {
    return `微信读书签到 · ${accountName ?? '微信读书'} · ${date} · 开始自动阅读`
}

/** 同一天同一种原因只提醒一次;需要人工处理的情况不受限制。 */
export function shouldNotifyOnce(dataDir, key, date) {
    if (ALWAYS_NOTIFY.has(key)) return true
    const file = path.join(dataDir, 'notify-state.json')
    let state = {}
    try {
        state = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch { /* 没有或损坏就当空 */ }
    if (state[key] === date) return false
    state[key] = date
    try {
        writeJsonAtomic(file, state)
    } catch { /* 写不进去也不影响通知本身 */ }
    return true
}
