// 四条消息的文案。硬规则:不用圆括号、不用 emoji,补充说明一律 ` · ` 分隔,
// 标题四段式 `<程序名> · <账号或账号数> · <日期> · <动作>`。
import { reasonText, followUpText, actionText } from './policy.js'

export const PROGRAM = 'B站任务'
const SEP = ' · '
const DEFAULT_ACCOUNT = '1 个账号'

const headline = (account, date, action) => [PROGRAM, account || DEFAULT_ACCOUNT, date, action].join(SEP)

export const buildStartMessage = ({ date, account = '' }) => headline(account, date, '开始运行')

export const renderExpLine = (exp = {}) => {
    const tail = exp.estimated ? `${SEP}按计划口径估算` : ''
    return `每日任务:登录 ${exp.login}${SEP}观看 ${exp.watch}${SEP}分享 ${exp.share}${SEP}投币 ${exp.coins}${SEP}共 ${exp.total} 经验${tail}`
}

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
    // R5:优先报实际发生的投币数(余额前后差值);取不到后值时明确标注这是目标
    const balance = donate.balanceAfter === null || donate.balanceAfter === undefined ? donate.balance : donate.balanceAfter
    // null / undefined / '' 都不算数字 —— 否则会渲染出 “余额 0.0” 这种没取到的假数字
    const hasBalance = balance !== null && balance !== undefined && balance !== '' && Number.isFinite(Number(balance))
    const tail = hasBalance ? ` · 余额 ${Number(balance).toFixed(1)}` : ''
    // 今日累计与本次不同时补一句:差值只算本次,接口的今日经验才是全天口径
    const total = donate.todayTotal !== null && donate.todayTotal !== undefined && Number(donate.todayTotal) > 0
        && Number(donate.todayTotal) !== Number(donate.actual)
        ? ` · 今日累计 ${Number(donate.todayTotal)} 枚`
        : ''
    const actual = donate.actual === null || donate.actual === undefined ? NaN : Number(donate.actual)
    if (Number.isFinite(actual)) {
        return actual === 0 ? `投币:0 枚 · 未投出${total}${tail}` : `投币:${actual} 枚 · 投给关注的 UP${total}${tail}`
    }
    return `投币:目标 ≤${donate.target} 枚 · 投给关注的 UP${total}${tail}`
}

const dateOf = (seconds) => {
    const value = Number(seconds)
    if (!Number.isFinite(value) || value <= 0) return ''
    // 券在北京时间零点过期,用固定 UTC+8 换算,与运行机器的本地时区无关
    return new Date((value + 8 * 3600) * 1000).toISOString().slice(0, 10)
}

export function renderVoucherLine(voucher = {}) {
    if (voucher.action === 'received') {
        const balance = Number.isFinite(Number(voucher.balance)) ? `${SEP}余额 ${Number(voucher.balance)}` : ''
        const expiry = dateOf(voucher.expireTime)
        const due = expiry ? `${SEP}有效至 ${expiry}` : ''
        const next = Number.isFinite(Number(voucher.nextReceiveDays)) ? `${SEP}下次可领 ${Number(voucher.nextReceiveDays)} 天后` : ''
        return `会员券:B币券已领取 ${voucher.count ?? 1} 张${balance}${due}${next}`
    }
    if (voucher.action === 'already') return '会员券:B币券已领取 0 张 · 今日已领过'
    if (voucher.action === 'unknown') return '会员券:状态未知 · 跳过 B币券'
    return '会员券:普通会员 · 跳过 B币券'
}

// 漫画行只说各流程自己报的结果。旧实现把 manga 系在与漫画无关的 task352 上,
// 2026-10-12 因此把「签到成功」报成「签到失败」—— 不再猜,只转述。
export const renderMangaLine = (manga) => {
    if (!manga || manga.skipped) return ''
    const signText = { ok: '签到成功', already: '今日已签到', failed: '签到失败', unknown: '签到结果未知' }
    const readText = { ok: `${SEP}阅读成功`, already: `${SEP}阅读已完成`, failed: `${SEP}阅读失败`, unknown: '' }
    return `漫画:${signText[manga.sign] ?? '签到结果未知'}${readText[manga.read] ?? ''}`
}

// 权益是每月一次的低价值项。失败但上游没给原因(通常是本月已领过)时不进消息,免得变成噪音。
export const renderMangaBenefitLine = (benefit) => {
    if (!benefit || benefit.status !== 'failed' || !benefit.reason) return ''
    return `漫画权益:领取失败${SEP}${benefit.reason}`
}
export const renderBigPointLine = (bigPoint) => (bigPoint === 'failed' ? '大积分:日常领取失败 · 该任务仅限手机端 App · 上游 open #1195' : '')

// 大积分「补领」:只有真的领到了才报数;接口返回成功但状态没变时如实写成「无效果」
// (2026-10-12 实测:照 App 抓包形状请求会返回 code=0,但 state/积分不变)。
export const renderBigPointClaimLine = (claim) => {
    if (!claim || !claim.attempted) return ''
    if (claim.changed.length === 0) return `大积分:补领 ${claim.attempted} 项无效果${SEP}缺 App 设备凭据`
    const gained = claim.gained > 0 ? `${SEP}积分 +${claim.gained}` : ''
    return `大积分:补领 ${claim.changed.length}/${claim.attempted} 项${gained}`
}

export function buildResultMessage({ date, account = '', exp, donate, voucher, manga, mangaBenefit, bigPoint, bigPointClaim, failures = [], ok = true }) {
    const lines = [renderExpLine(exp)]
    for (const failure of failures) lines.push(`  原因:${failure.note}`)
    lines.push(renderDonateLine(donate))
    lines.push(renderVoucherLine(voucher))
    if (manga) lines.push(renderMangaLine(manga))
    const benefitLine = renderMangaBenefitLine(mangaBenefit)
    if (benefitLine) lines.push(benefitLine)
    const bigPointLine = renderBigPointLine(bigPoint)
    if (bigPointLine) lines.push(bigPointLine)
    const claimLine = renderBigPointClaimLine(bigPointClaim)
    if (claimLine) lines.push(claimLine)
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
