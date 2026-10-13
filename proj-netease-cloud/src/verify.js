// T6:请求结果的分类矩阵与成长基线(设计文档第 5 节「处理矩阵」在这里定死,避免「一概重试」)。
//   登录失效(301/302/8810/-462/-460/447/401/403) → auth       → 不重试、当天熔断、推 action
//   限流 / 过于频繁(429 或文案)                    → rate-limit → 不重试、当天熔断、如实记录
//   网络异常 / 超时                                 → network    → 退避后重试一次,仅一次
//   HTTP 200 但业务字段未成功                        → businessAction → 判失败、不重试
//   接口返回结构变了                                 → shape      → 记录原始响应、推 action
// 纯函数:无 IO、无网络、不抛。判定只依据传入的描述对象。
export const AUTH_CODES = Object.freeze([301, 302, 8810, -462, -460, 447])
export const RATE_LIMIT_PATTERN = /过于频繁|限流|频繁|rate.?limit|too many/i
export const AUTH_PATTERN = /未登录|凭据|登录失效|鉴权|失效/i
export const NETWORK_PATTERN = /超时|网络|timeout|abort|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|socket/i

const messageOf = (error) => {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return ''
}

/**
 * 纯函数:把一次请求的失败描述归到矩阵的一类。
 * 输入 { code, httpStatus, error };若调用方直接透传 client.js 的结果,reason 也会被采纳。
 * 返回 'auth' | 'rate-limit' | 'network' | 'shape' | 'ok'。
 */
export function classifyError(signal = {}) {
  const code = signal.code ?? null
  const httpStatus = signal.httpStatus ?? null
  const reason = signal.reason ?? null
  const text = messageOf(signal.error)
  if (httpStatus === 429 || code === 429 || RATE_LIMIT_PATTERN.test(text)) return 'rate-limit'
  if (reason === 'auth' || reason === 'no-cookie') return 'auth'
  if (AUTH_CODES.includes(code) || httpStatus === 401 || httpStatus === 403) return 'auth'
  if (AUTH_PATTERN.test(text)) return 'auth'
  if (reason === 'network' || NETWORK_PATTERN.test(text)) return 'network'
  if (reason === 'ok') return 'ok'
  const clean = !text && httpStatus === null && (code === null || code === 200) && (reason === null || reason === 'ok')
  return clean ? 'ok' : 'shape'
}

/**
 * 纯函数:给定分类与已重试次数,返回下一步动作。
 * 返回 'retry-once' | 'circuit-break-and-notify' | 'fail';'ok' 不需要动作,返回 null。
 */
export function nextAction(kind, attempt = 0) {
  if (kind === 'auth' || kind === 'rate-limit') return 'circuit-break-and-notify'
  if (kind === 'network') return attempt >= 1 ? 'fail' : 'retry-once'
  if (kind === 'shape') return 'fail'
  return null
}

/**
 * 纯函数:业务层结论 → 动作。businessOk 为 true 才算成功;
 * false(HTTP 200 但业务未生效)与 null(字段缺失、未能确认)都判失败且不重试。
 */
export function businessAction(businessOk) {
  return businessOk === true ? null : 'fail'
}

// ── 成长基线:首次运行采 day0 基线,之后用「绝对值 + 相对基线变化」双口径判定 ──
export const BASELINE_KEYS = Object.freeze(['yunbei', 'growthPoint'])

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** 首次运行用 snapshot 建立基线;已有基线原样保留(基线只在 day0 采一次)。 */
export function day0Baseline(state, snapshot) {
  const existing = state && typeof state === 'object' ? state.baseline : null
  if (existing && typeof existing === 'object') return { ...existing }
  const baseline = {}
  for (const key of BASELINE_KEYS) baseline[key] = num(snapshot?.[key])
  return baseline
}

/** 相对基线的变化;没有基线返回 null,调用方据此退化为绝对值判定。 */
export function deltaFromBaseline(state, snapshot) {
  const existing = state && typeof state === 'object' ? state.baseline : null
  if (!existing || typeof existing !== 'object') return null
  const delta = {}
  for (const key of BASELINE_KEYS) {
    const base = num(existing[key])
    const now = num(snapshot?.[key])
    delta[key] = base === null || now === null ? null : now - base
  }
  return delta
}

/** 双口径判定:无基线 → mode 'absolute'(绝对值),有基线 → mode 'baseline'(差值)。 */
export function assessGrowth(state, snapshot) {
  const absolute = {}
  for (const key of BASELINE_KEYS) absolute[key] = num(snapshot?.[key])
  const delta = deltaFromBaseline(state, snapshot)
  return delta === null ? { mode: 'absolute', delta: null, absolute } : { mode: 'baseline', delta, absolute }
}
