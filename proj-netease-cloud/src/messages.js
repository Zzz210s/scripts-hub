// T8:四类消息渲染。纯函数 —— 不发送、不落盘、不读时钟。
// 硬规则:不用圆括号(全角半角都不行)、不用 emoji,补充说明一律 ` · ` 分隔,
// 标题四段式 `<程序名> · <账号或账号数> · <日期> · <动作>`。
// 数字一律来自入参的接口数据,本文件不估算、不补零。
// 长度护栏:企业微信文本上限 2048 字节(UTF-8),超出按整行截断并保留标题与结论行。
//
// 与贴吧实现的有意差异:贴吧只有一个「对账」结论,网易云把结论拆成两段 ——
// VIP 乐签的读回结论与云贝只读查询结果。判定口径是 vip.businessOk(读回为权威):
// businessOk 为 false 或 null 时消息里绝不能出现「成功」二字(回归用例),
// null 如实渲染成「未能确认」。baseline 只写相对基线的变化,没有基线就不写这一行。
import { REASONS, SEP, accountFailText, actionText, followUpText, reasonText, safeText } from './message-text.js'

export const PROGRAM = '网易云音乐签到'
export const LIMIT_BYTES = 2048

// 词表在 message-text.js;这里原样转出,调用方与测试只需认 messages.js 一个入口。
export { REASONS, accountFailText, actionText, followUpText, reasonText } from './message-text.js'

/** UTF-8 字节数;企业微信的限制按字节算,不是字符数。 */
export const byteLength = (text) => Buffer.byteLength(String(text ?? ''), 'utf8')

/** 按字符截到字节预算内(不劈开码点)。 */
function clipTo(text, budget) {
  if (byteLength(text) <= budget) return text
  let out = ''
  for (const char of text) {
    if (byteLength(out + char) > budget) break
    out += char
  }
  return out
}

/** 超长动态标题截断并补省略标记 —— 截断处不能看起来像完整的账号名。 */
function clipHead(head, budget) {
  if (byteLength(head) <= budget) return head
  const marker = budget > 4 ? '...' : ''
  return clipTo(head, budget - byteLength(marker)) + marker
}

/** 只认有限数字;null / undefined / '' / NaN 一律当「没取到」,不编 0。 */
const num = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const signed = (value) => (value >= 0 ? `+${value}` : `${value}`)

/** 账号列表:优先 accounts 数组,兼容单账号 ctx.account。 */
const listOf = (ctx) => {
  if (Array.isArray(ctx?.accounts)) return ctx.accounts
  if (ctx?.account) return [ctx.account]
  return []
}

const accountLabel = (list) => {
  if (list.length === 1) return safeText(list[0]?.name) || '账号未知'
  if (list.length > 1) return `${list.length} 个账号`
  return '账号未知'
}

const headline = (list, date, action) =>
  [PROGRAM, accountLabel(list), date ? safeText(date) : '日期未知', action].join(SEP)

/** 读回是唯一权威:true=已确认,false=未生效,缺失=未能确认。三态各自有词,不混用。 */
const vipWord = (vip) =>
  vip?.businessOk === true ? 'VIP 乐签:已确认' : vip?.businessOk === false ? 'VIP 乐签:未生效' : 'VIP 乐签:未能确认'

/** 云贝只读查询的一行;字段缺失写「未知」,失败写「暂不可用」,不崩不谎报。 */
const yunbeiWord = (yunbei) => {
  if (!yunbei || yunbei.ok !== true) return '云贝:暂不可用'
  const balance = num(yunbei.balance)
  const head = balance === null ? '云贝:余额未知' : `云贝:余额 ${balance}`
  const status =
    yunbei.signedToday === true ? '今日已签' : yunbei.signedToday === false ? '今日未签' : '签到状态未知'
  return `${head}${SEP}${status}`
}

/** 相对基线的变化:基线或本次数字缺一就不写这一行,不用「较昨日」冒充基线。 */
function baselineWord(baseline, yunbei) {
  if (!baseline || typeof baseline !== 'object') return null
  const base = num(baseline.yunbei)
  const now = num(yunbei?.balance)
  return base === null || now === null ? null : `相对基线 ${signed(now - base)}`
}

/** 未确认时的一行原因:优先上游错误原文,其次机器码的账号级文案,都没有就不写。 */
function failReason(account, vip) {
  const explicit = safeText(vip?.error) || safeText(account?.error)
  if (explicit) return explicit
  const reason = vip?.reason ?? account?.reason
  if (reason && reason !== 'ok') return accountFailText(reason)
  return null
}

/** 逐账号一段(账号行 + 可选缩进原因行),按传入顺序,不排序。 */
function accountBlock(account, ctx) {
  const vip = account?.vip ?? ctx.vip
  const yunbei = account?.yunbei ?? ctx.yunbei
  const name = safeText(account?.name) || '未命名'
  const parts = [vipWord(vip), yunbeiWord(yunbei)]
  const base = baselineWord(account?.baseline ?? ctx.baseline, yunbei)
  if (base) parts.push(base)
  const lines = [`账号 ${name}${SEP}${parts.join(SEP)}`]
  if (vip?.businessOk !== true) {
    const why = failReason(account, vip)
    if (why) lines.push(`  原因:${why}`)
  }
  return lines
}

/** 整体成功口径:显式 ok 优先,其次读回结论,最后才看逐账号(全部确认才算成功)。 */
function overallOk(ctx, list) {
  if (ctx.ok !== undefined) return ctx.ok === true
  if (ctx.vip !== undefined) return ctx.vip?.businessOk === true
  return list.length > 0 && list.every((one) => one?.ok === true && one?.vip?.businessOk === true)
}

/** 按 UTF-8 字节预算拼装:超限时整行丢弃正文并加省略标记,结论行始终保留。 */
function assemble(head, body, foot) {
  const join = (title, lines) => [title, '', ...lines].join('\n')
  const footText = foot.join('\n')
  const footReserve = Math.min(byteLength(footText), LIMIT_BYTES - 64)
  head = clipHead(head, LIMIT_BYTES - 2 - footReserve)
  if (byteLength(join(head, [...body, ...foot])) <= LIMIT_BYTES) return join(head, [...body, ...foot])
  // 省略标记的文案只在 omitLine 一处生成:循环内预估与循环外实写不会漂移。
  const omitLine = (count) => `...已省略 ${count} 行`
  const kept = []
  for (const line of body) {
    // 试算「收下这一行后还要省略几行」:此刻 kept 还没 push,故比实写时多减 1。
    const marker = omitLine(body.length - kept.length - 1)
    if (byteLength(join(head, [...kept, line, marker, ...foot])) > LIMIT_BYTES) break
    kept.push(line)
  }
  const dropped = body.length - kept.length
  const lines = dropped > 0 ? [...kept, omitLine(dropped)] : kept
  lines.push(...foot)
  const out = join(head, lines)
  if (byteLength(out) <= LIMIT_BYTES) return out
  return `${head}\n\n${clipTo(footText, Math.max(0, LIMIT_BYTES - byteLength(head) - 2))}`
}

export function buildStart({ date, account, accounts } = {}) {
  return clipHead(headline(listOf({ account, accounts }), date, '开始运行'), LIMIT_BYTES)
}

export function buildResult({ date, account, accounts, vip, yunbei, baseline, exitCode, dryRun, ok: okFlag } = {}) {
  const ctx = { account, accounts, vip, yunbei, baseline, ok: okFlag }
  const list = listOf(ctx)
  const dry = dryRun === true
  const ok = dry ? false : overallOk(ctx, list)
  const action = dry ? '预览,未运行' : ok ? '运行成功' : '运行有失败'
  const blocks = list.length ? list : vip !== undefined || yunbei !== undefined ? [account ?? {}] : []
  const body = blocks.flatMap((one) => accountBlock(one, ctx))
  const foot = []
  if (dry) foot.push('模式:预览,未运行 · 没有落盘 · 没有发送')
  const code = num(exitCode)
  if (!dry && code !== null && code !== 0) foot.push(`退出码:${code}`)
  return assemble(headline(list, date, action), body, foot)
}

export function buildSkip({ date, account, accounts, reason } = {}) {
  const list = listOf({ account, accounts })
  // 动作类原因若被误路由到 skip,也不能谎称「不需要」处理。
  const needsYou = REASONS[reason]?.action?.please?.replace(/^请你:/, '')
  return assemble(headline(list, date, '正常跳过'), [], [
    `原因:${reasonText(reason)}`,
    `后续:${followUpText(reason)}`,
    `你需要做什么:${needsYou ?? '不需要'}`,
  ])
}

export function buildAction({ date, account, accounts, reason } = {}) {
  const list = listOf({ account, accounts })
  const { please, reason: why, consequence } = actionText(reason)
  const lines = [please, `原因:${why}`, `不处理的后果:${consequence}`]
  for (const one of list) {
    const detail = safeText(one?.error)
    if (detail) lines.push(`  细节:${safeText(one?.name) || '未命名'}${SEP}${detail}`)
  }
  return assemble(headline(list, date, '需要你处理'), [], lines)
}
