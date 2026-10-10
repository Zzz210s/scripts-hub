// 四条消息的文案。硬规则:不用圆括号、不用 emoji,补充说明一律 ` · ` 分隔,
// 标题四段式 `<程序名> · <账号或账号数> · <日期> · <动作>`。
import { reasonText, followUpText, actionText } from './policy.js'

export const PROGRAM = 'B站任务'
const SEP = ' · '
const DEFAULT_ACCOUNT = '1 个账号'

const headline = (account, date, action) => [PROGRAM, account || DEFAULT_ACCOUNT, date, action].join(SEP)

export const buildStartMessage = ({ date, account = '' }) => headline(account, date, '开始运行')

export const renderExpLine = (exp = {}) =>
    `每日任务:登录 ${exp.login} · 观看 ${exp.watch} · 分享 ${exp.share} · 投币 ${exp.coin} · 共 ${exp.total} 经验`

const DONATE_STOP = {
    'balance-zero': '投币:跳过 · 硬币余额为 0',
    'below-threshold': (d) => `投币:跳过 · 硬币余额不高于保留值 ${d.threshold}`,
    'no-followings': '投币:跳过 · 关注列表为空',
    'unknown-followings': '投币:跳过 · 无法确认关注列表',
    'no-balance': '投币:跳过 · 未取到硬币余额'
}

export function renderDonateLine(donate = {}) {
    if (donate.stop) {
        const rule = DONATE_STOP[donate.reason]
        if (typeof rule === 'function') return rule(donate)
        return rule ?? `投币:跳过 · ${donate.reason}`
    }
    const balance = Number.isFinite(Number(donate.balance)) ? ` · 余额 ${Number(donate.balance).toFixed(1)}` : ''
    return `投币:${donate.target} 枚 · 投给关注的 UP${balance}`
}

export function renderVoucherLine(voucher = {}) {
    if (voucher.action === 'received') {
        const balance = Number.isFinite(Number(voucher.balance)) ? ` · 余额 ${Number(voucher.balance)}` : ''
        const next = Number.isFinite(Number(voucher.nextReceiveDays)) ? ` · 下次可领 ${Number(voucher.nextReceiveDays)} 天后` : ''
        return `会员券:B币券已领取 ${voucher.count ?? 1} 张${balance}${next}`
    }
    if (voucher.action === 'already') return '会员券:B币券已领取 0 张 · 今日已领过'
    if (voucher.action === 'unknown') return '会员券:状态未知 · 跳过 B币券'
    return '会员券:普通会员 · 跳过 B币券'
}

export const renderMangaLine = (manga) => (manga === 'failed' ? '漫画:签到失败' : '漫画:签到 1 · 漫读券已领')
export const renderBigPointLine = (bigPoint) => (bigPoint === 'failed' ? '大积分:失败 · 接口要求升级客户端' : '')

export function buildResultMessage({ date, account = '', exp, donate, voucher, manga, bigPoint, failures = [], ok = true }) {
    const lines = [renderExpLine(exp)]
    for (const failure of failures) lines.push(`  原因:${failure.note}`)
    lines.push(renderDonateLine(donate))
    lines.push(renderVoucherLine(voucher))
    if (manga) lines.push(renderMangaLine(manga))
    const bigPointLine = renderBigPointLine(bigPoint)
    if (bigPointLine) lines.push(bigPointLine)
    return `${headline(account, date, ok ? '运行成功' : '运行有失败')}\n\n${lines.join('\n')}`
}

export function buildSkipMessage({ date, account = '', reason }) {
    return `${headline(account, date, '正常跳过')}\n\n原因:${reasonText(reason)}\n后续:${followUpText(reason)}\n你需要做什么:不需要`
}

export function buildActionMessage({ date, account = '', kind = 'cookie-invalid', detail }) {
    const { please, reason, consequence } = actionText(kind)
    const lines = [please, `原因:${reason}`, `不处理的后果:${consequence}`]
    if (detail) lines.push(`细节:${detail}`)
    return `${headline(account, date, '需要你处理')}\n\n${lines.join('\n')}`
}
