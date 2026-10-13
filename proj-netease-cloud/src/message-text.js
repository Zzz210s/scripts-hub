// T8 的词表:跳过 / 人工处理 / 账号级失败三类原因码的文案。纯数据 + 纯查表,没有逻辑。
// 硬规则:不用圆括号、不用 emoji,补充说明一律 ` · ` 分隔。
// 未知码一律显式兜底(把码原样写出来),不静默渲染成 undefined 或空串。
//
// 与贴吧词表的差异:原因码按网易云的实际语义改写 —— 熔断 circuit-broken、鉴权 auth、
// 限流 rate-limit、结构变化 shape、网络 network;不存在贴吧的「对账 / 关注列表」类码。

export const SEP = ' · '
const UNKNOWN = '未识别'

/** 原因码的显示形式:空值也不能渲染成空串或 undefined;码本身也走消毒。 */
const codeOf = (reason) => {
  if (reason === undefined || reason === null || reason === '') return '无'
  return safeText(String(reason)) || '无'
}

/**
 * 跳过 / 人工处理原因词表 —— 必须覆盖守卫的全部机器可读码(见 T7 guards)与 T6 处理矩阵。
 * action 只给「不处理就会一直不跑」的那几个码;其余码走通用兜底(诚实说明)。
 */
export const REASONS = {
  // 守卫放行时给的就是这个码,它不是「跳过」—— 但同样要有文案,否则误路由到 skip 会写成未知码。
  ok: { text: '当前状态正常,没有需要跳过的', followUp: '按计划继续跑' },
  paused: { text: '程序已被手动暂停', followUp: '恢复运行前不会自动跑' },
  'done-today': { text: '今天已经签完了', followUp: '明天重新开始' },
  'circuit-broken': {
    text: '今天已因鉴权或限流熔断',
    followUp: '明天重新开始 · 先更新 .env 里的 MUSIC_U',
    action: {
      please: '请你:重新登录网易云音乐,把新的 MUSIC_U 写进 .env',
      consequence: '不更新就明天之前不会再请求 · 当天的 VIP 乐签会漏',
    },
  },
  'attempts-exhausted': { text: '今天可用的尝试次数已用尽', followUp: '明天重新开始' },
  'peer-running': { text: '同伴程序正在运行', followUp: '下一次触发会再看' },
  'quiet-hours': { text: '当前是安静时段', followUp: '安静时段结束后会再跑' },
  'before-shutdown': { text: '临近关机时刻', followUp: '下一次触发会再看' },
  'low-memory': { text: '可用内存不足', followUp: '下一次触发会重试' },
  'no-credentials': {
    text: '还没有配置可用的账号凭据',
    followUp: '把 MUSIC_U 写进 .env 后就会开始跑',
    action: {
      please: '请你:把账号 MUSIC_U 写进 .env 的 ACCOUNT_1_MUSIC_U',
      consequence: '不配置就永远不会开始签到 · 每天的 VIP 乐签都会漏',
    },
  },
  'credentials-invalid': {
    text: '全部账号的凭据都已失效',
    followUp: '更新 .env 里的 MUSIC_U 后会开始跑',
    action: {
      please: '请你:重新登录网易云音乐,把新的 MUSIC_U 更新到 .env',
      consequence: '不更新就永远不会开始签到 · 每天的 VIP 乐签都会漏',
    },
  },
  auth: {
    text: '账号凭据已失效',
    followUp: '更新 MUSIC_U 后下一次触发会重试',
    action: {
      please: '请你:重新登录网易云音乐,把新的 MUSIC_U 更新到 .env',
      consequence: '不更新就一直停在鉴权失败 · 当天已熔断,只等明天',
    },
  },
  'rate-limit': {
    text: '接口提示操作过于频繁',
    followUp: '当天已熔断,明天再试',
    action: {
      please: '请你:确认没有别的程序在同时用这个账号,或换一段低峰时间',
      consequence: '继续高频请求会加重风控 · 当天已熔断,只等明天',
    },
  },
  shape: {
    text: '接口返回结构与预期不符',
    followUp: '下一次触发会重新核对',
    action: {
      please: '请你:把运行日志里的原始响应发出来,核对接口是否改版',
      consequence: '字段对不上时无法确认签到结果 · 会一直判失败',
    },
  },
  network: {
    text: '网络请求没有送达',
    followUp: '退避重试一次后仍失败则等下一次触发',
    action: {
      please: '请你:确认这台机器能出网且没有代理拦截',
      consequence: '网络不通时无法签到 · 会按尝试次数上限收敛',
    },
  },
}

export const reasonText = (reason) => REASONS[reason]?.text ?? `${UNKNOWN}的跳过原因:${codeOf(reason)}`
export const followUpText = (reason) => REASONS[reason]?.followUp ?? '下一次触发会再看'

/**
 * 账号级失败的原因码(来自 client),与「跳过原因」不是一回事:
 * 复用 reasonText 会渲染成「未识别的跳过原因:auth」,措辞串了。这里单独一套文案。
 */
const ACCOUNT_FAIL_TEXT = {
  'no-cookie': '账号凭据里没有 MUSIC_U,连请求都没发',
  auth: '服务器判定登录状态已失效',
  parse: '接口返回无法解析',
  http: '接口返回了错误状态',
  network: '网络请求没有送达',
}

export const accountFailText = (reason) => ACCOUNT_FAIL_TEXT[reason] ?? `账号级失败,机器码 ${codeOf(reason)}`

/** 人工处理文案。表里没写 action 的码也能渲染成一条诚实的提示,不留空白。 */
export function actionText(reason) {
  const known = REASONS[reason]
  if (known?.action) return { ...known.action, reason: known.text }
  return {
    please: `请你:对照运行日志确认原因 ${codeOf(reason)} 是否需要处理`,
    reason: known?.text ?? `${UNKNOWN}的处理原因:${codeOf(reason)}`,
    consequence: known?.followUp ?? '不处理时程序会按正常跳过处理 · 下一次触发会再看',
  }
}

/** emoji / 符号区段:账号名与上游错误串都可能自带 emoji,硬规则不许它进消息。 */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu

/**
 * 自由文本消毒:账号名 / 上游错误串都可能自带圆括号与 emoji,
 * 而硬规则要求消息里两者都不出现 —— 括号换空格、emoji 直接删掉,再收敛空白与分隔符。
 */
export const safeText = (value = '') => String(value ?? '')
  .replace(/[()（）]/g, ' ')
  .replace(EMOJI, '')
  .replace(/\s+/g, ' ')
  .replace(/(?:\s*·\s*)+/g, ' · ')
  .replace(/^\s*·\s*|\s*·\s*$/g, '')
  .trim()
