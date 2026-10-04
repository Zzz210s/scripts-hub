// 四条消息的文案。硬规则见 docs/notification-convention.md:不用圆括号、不用 emoji,
// 补充说明一律用 ` · ` 分隔,标题四段式 `<程序名> · <账号或账号数> · <日期> · <动作>`。
import { formatLocal } from './clock.js'
import { reasonText, followUpText, actionText } from './policy.js'

export const PROGRAM = 'Epic 限免'
const SEP = ' · '
const DEFAULT_ACCOUNT = '1 个账号'
const FAILED_STATUSES = new Set(['failed', 'missing', 'unavailable', 'requires-base-game'])

export const STATUS_TEXT = {
    claimed: '已领取',
    existed: '已在库',
    failed: '未领取',
    missing: '未领取',
    unavailable: '本区不可领',
    'requires-base-game': '需要基础游戏'
}

const headline = (account, date, action) => [PROGRAM, account || DEFAULT_ACCOUNT, date, action].join(SEP)

const deadlineText = (cycleEnd) => (cycleEnd ? ` · 截止 ${formatLocal(new Date(cycleEnd))}` : '')

const gameLine = (game) => {
    const head = `${STATUS_TEXT[game.status] ?? game.status} ${game.title}`
    const price = game.originalPrice ? `${SEP}原价 ${game.originalPrice}` : ''
    const line = `${head}${price}`
    return game.note ? `${line}\n  原因:${game.note}` : line
}

export const hasFailure = (games = []) => games.some((game) => FAILED_STATUSES.has(game.status))

/** start:只有一行(见 notification-convention.md 第 2 节)。 */
export const buildStartMessage = ({ date, account }) => headline(account, date, '开始领取')

/** result:标题 + 空行 + 逐条一行;失败项在下面缩进两格写原因。 */
export function buildResultMessage({ date, account, games = [], cycleEnd }) {
    const end = cycleEnd ?? games.find((game) => game.endAt)?.endAt
    const lines = [`本期限免 ${games.length} 个${deadlineText(end)}`]
    for (const game of games) lines.push(gameLine(game))
    return `${headline(account, date, hasFailure(games) ? '运行有失败' : '运行成功')}\n\n${lines.join('\n')}`
}

/** skip:标题 / 空行 / 原因 / 后续 / 你需要做什么:不需要。 */
export function buildSkipMessage({ date, account, reason }) {
    return `${headline(account, date, '正常跳过')}\n\n原因:${reasonText(reason)}\n后续:${followUpText(reason)}\n你需要做什么:不需要`
}

/** action:标题 / 空行 / 请你 / 原因 / 不处理的后果 / 逐条结账链接。登录态失效时给链接没用,只让人去登录。 */
export function buildActionMessage({ date, account, kind = 'captcha', items = [] }) {
    const { please, reason, consequence } = actionText(kind)
    const lines = [please, `原因:${reason}`, `不处理的后果:${consequence}`]
    if (kind !== 'login') {
        for (const item of items) {
            if (!item?.checkout) continue
            lines.push(`结账链接:${item.checkout}${item.title ? `${SEP}${item.title}` : ''}`)
        }
    }
    return `${headline(account, date, '需要你处理')}\n\n${lines.join('\n')}`
}
