// run.js 的小纯函数与跳过消息路由。拆成独立文件只为守住单文件 200 行上限(全局规则 A17),
// 不引入任何 I/O:路由 / 账号形状适配 / 同伴判定都是纯逻辑,便于单独推敲。
import { peerBusy } from './guards.js';
import { buildAction } from './messages.js';

/** 正常跳过、只写日志不推送的原因。其余守卫原因都要推一条 action(见 routeSkip)。 */
export const SILENT_SKIP = new Set(['done-today', 'peer-running', 'quiet-hours']);
const ZERO_COUNTS = { signed: 0, already: 0, blocked: 0, tbsStale: 0, failed: 0 };

/** 账号视图:消息层只需要名字,逐账号计数来自签到结果。 */
export const view = (accounts) => accounts.map((account) => ({ name: account.name }));

/** 跳过消息路由:静默集合只写日志,其余渲染成一条需要你处理的 action。 */
export function routeSkip({ reason, date, accounts }) {
  if (SILENT_SKIP.has(reason)) return { silent: true, messages: [] };
  return { silent: false, messages: [buildAction({ date, accounts, reason })] };
}

/** 凭据失效的账号:不重试,直接按失败记账 —— 它没有 tbs,连请求都发不出去。 */
export const failedAccount = (name, error, reason) => ({
  name,
  ok: false,
  results: [],
  counts: { ...ZERO_COUNTS },
  error,
  reason: reason ?? 'failed',
});

/** 读不到列表的账号:对账据此判「未知」ok:null,不静默算通过。 */
export const failedList = (error, reason) => ({ ok: false, forums: null, count: 0, hasMore: false, error, reason });

/** 历史里只存渲染需要的字段,不把逐吧结果整份写进去。 */
export const trimAccounts = (outcomes) =>
  outcomes.map(({ name, ok, counts, error, reason, emptyForums, incompleteForums }) => ({
    name,
    ok,
    counts,
    error,
    reason,
    emptyForums,
    incompleteForums,
  }));

/** 同伴判定:测试可整体注入;否则走 peerBusy 的「读锁 + 调 lock-status」口径。 */
export function peerOf(deps, config, now) {
  if (typeof deps.peerRunning === 'function') {
    const value = deps.peerRunning();
    if (typeof value === 'boolean') return { busy: value, detail: '' };
    return value ?? { busy: false, detail: '' };
  }
  return peerBusy(config.busyPeers, { exec: deps.exec, nowMs: now.getTime() });
}
