// Task 8 的词表:跳过 / 人工处理 / 对账三类原因码的文案。纯数据 + 纯查表,没有逻辑。
// 硬规则:不用圆括号、不用 emoji,补充说明一律 ` · ` 分隔。
// 未知码一律显式兜底(把码原样写出来),不静默渲染成 undefined 或空串。

export const SEP = ' · ';
const UNKNOWN = '未识别';

/** 原因码的显示形式:空值也不能渲染成空串或 undefined。 */
const codeOf = (reason) => (reason === undefined || reason === null || reason === '') ? '无' : String(reason);

/**
 * 跳过 / 人工处理原因词表 —— 必须覆盖守卫的全部机器可读码(见 Task 7)。
 * action 只给「不处理就会一直不跑」的那几个码;其余码走通用兜底(诚实说明)。
 */
export const REASONS = {
  paused: { text: '程序已被手动暂停', followUp: '恢复运行前不会自动跑' },
  'done-today': { text: '今天已经签完了', followUp: '明天重新开始' },
  'attempts-exhausted': { text: '今天可用的尝试次数已用尽', followUp: '明天重新开始' },
  'peer-running': { text: '同伴程序正在运行', followUp: '下一次触发会再看' },
  'quiet-hours': { text: '当前是安静时段', followUp: '安静时段结束后会再跑' },
  'before-shutdown': { text: '临近关机时刻', followUp: '下一次触发会再看' },
  'low-memory': { text: '可用内存不足', followUp: '下一次触发会重试' },
  'no-credentials': {
    text: '还没有配置可用的账号凭据',
    followUp: '把账号 BDUSS 写进 .env 后就会开始跑',
    action: {
      please: '请你:在跑这个程序的机器上把账号 BDUSS 写进 .env 的 ACCOUNT_n_BDUSS',
      consequence: '不配置就永远不会开始签到 · 每天的贴吧都会漏签'
    }
  },
  'credentials-invalid': {
    text: '全部账号的凭据都已失效',
    followUp: '更新 .env 里的 BDUSS 后会开始跑',
    action: {
      please: '请你:重新登录百度贴吧,把新的 BDUSS 更新到 .env',
      consequence: '不更新就永远不会开始签到 · 每天的贴吧都会漏签'
    }
  },
  'list-failed': {
    text: '关注列表没有取到,无法核对',
    followUp: '下一次触发会重新核对',
    action: {
      please: '请你:查看运行日志里的账号与接口返回,确认登录状态与网络',
      consequence: '对账一直不通过时当天不会标记完成 · 会反复重试'
    }
  }
};

export const reasonText = (reason) => REASONS[reason]?.text ?? `${UNKNOWN}的跳过原因:${codeOf(reason)}`;
export const followUpText = (reason) => REASONS[reason]?.followUp ?? '下一次触发会再看';

/** 人工处理文案。表里没写 action 的码也能渲染成一条诚实的提示,不留空白。 */
export function actionText(reason) {
  const known = REASONS[reason];
  if (known?.action) return { ...known.action, reason: known.text };
  return {
    please: `请你:对照运行日志确认原因 ${codeOf(reason)} 是否需要处理`,
    reason: known?.text ?? `${UNKNOWN}的处理原因:${codeOf(reason)}`,
    consequence: known?.followUp ?? '不处理时程序会按正常跳过处理 · 下一次触发会再看'
  };
}

const RECONCILE_TEXT = {
  ok: '全部已签',
  missing: '有吧没签上',
  truncated: '关注列表被截断,可能还有没签的吧',
  'empty-forums': '关注列表为空',
  'expected-empty': '过滤后没有需要签的吧',
  'list-failed': '关注列表没取到,无法判定',
  'no-accounts': '没有可对账的账号'
};

export const reconcileText = (reason) => RECONCILE_TEXT[reason] ?? `${UNKNOWN}的对账原因:${codeOf(reason)}`;

/**
 * 自由文本消毒:吧名 / 账号名 / 上游错误串都可能自带圆括号,
 * 而硬规则要求消息里不出现圆括号 —— 这里把它们换成空格并收敛空白与分隔符。
 */
export const safeText = (value = '') => String(value ?? '')
  .replace(/[()（）]/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/(?:\s*·\s*)+/g, ' · ')
  .replace(/^\s*·\s*|\s*·\s*$/g, '')
  .trim();
