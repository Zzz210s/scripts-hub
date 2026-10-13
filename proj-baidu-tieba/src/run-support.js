// run.js 的编排辅助与跳过消息路由。拆成独立文件是为了守住单文件 200 行上限(全局规则 A17):
// 账号形状适配 / 跳过路由 / 投递记账是纯逻辑,凭据体检与逐账号签到是薄适配 —— 都不做判定,
// 「今天算不算完成」只由 verify.js 的对账决定。
import { signAccount } from './account.js';
import { fetchFollowedForums, fetchTbs } from './client.js';
import { peerBusy } from './guards.js';
import { buildAction } from './messages.js';

/**
 * 正常跳过、只写日志不推送的原因。
 * 除了「本来就不用跑」的三条,`paused` 是人自己按的、`low-memory` 是瞬时压力且当天还会再试,
 * 都属「不需要人现在动手」;`attempts-exhausted` 与 `before-shutdown` 不放进来 ——
 * 它们意味着**今天可能跑不成**,那正是用户要知道的事。
 */
export const SILENT_SKIP = new Set(['done-today', 'peer-running', 'quiet-hours', 'paused', 'low-memory']);
const ZERO_COUNTS = { signed: 0, already: 0, blocked: 0, tbsStale: 0, failed: 0 };

/** 账号视图:消息层只需要名字(以及凭据失败时的错误细节);重名消歧后在文本里也唯一。 */
export const view = (accounts) =>
  accounts.map((account) => ({
    id: account.id,
    name: account.name,
    error: account.error,
    reason: account.reason,
  }));

/** 唯一 id -> 显示名。对账内部以 id 为键,渲染时才换回名字。 */
export const labelMap = (accounts) =>
  Object.fromEntries(accounts.map((account) => [account.id, account.name]));

/**
 * 把对账结论里的 id 键换回显示名,同时保留 id 供消息层逐账号配对。
 * 判定本身(ok / missingTotal / reasons)不动 —— 显示名只影响可读性。
 */
export function relabelReconcile(result, labels) {
  if (!result || typeof result !== 'object') return result;
  const label = (value) => labels?.[value] ?? value;
  return {
    ...result,
    perAccount: (result.perAccount ?? []).map((item) => ({ ...item, id: item.name, name: label(item.name) })),
    unresolvedAccounts: (result.unresolvedAccounts ?? []).map(label),
  };
}

/**
 * 统一发送入口:把消息文本记进 messages,把投递结果记进 deliveries。没注入发送器时
 * 显式记为失败 —— 否则「没发送器」与「发送成功了」在返回值里长得一样,现场无从区分。
 */
export function makeDeliver(deps, sinks) {
  return async (text) => {
    const { messages, deliveries } = sinks;
    messages.push(text);
    let delivery;
    if (typeof deps?.send !== 'function') delivery = { ok: false, error: '没有注入发送器' };
    else {
      try {
        delivery = (await deps.send(text)) ?? { ok: true };
      } catch (error) {
        delivery = { ok: false, error: error?.message ?? String(error) };
      }
    }
    deliveries.push(delivery);
    return delivery;
  };
}

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

/** 逐账号凭据体检:键用唯一 id;单账号失效不拦整轮(判定交给 checkOnlineGuards)。 */
export async function probeCredentials(accounts, deps) {
  const credentials = [];
  for (const account of accounts) {
    const probe = await fetchTbs({ cookie: account.cookie, deps });
    credentials.push({ id: account.id, name: account.name, ok: probe.ok, error: probe.error, reason: probe.reason });
  }
  return credentials;
}

/**
 * 逐账号串行签到,签完立刻读回该账号的关注列表。凭据失效的账号直接按失败记账、不重试。
 * 结果与读回都按唯一 id 归位 —— 同名账号不能互相覆盖。
 */
export async function signAll({ accounts, credentials, config, deps }) {
  const outcomes = [];
  const forumsAfter = {};
  for (const account of accounts) {
    const credential = credentials.find((item) => item.id === account.id);
    if (credential?.ok !== true) {
      outcomes.push({ ...failedAccount(account.name, credential?.error, credential?.reason), id: account.id });
      forumsAfter[account.id] = failedList(credential?.error, credential?.reason);
      continue;
    }
    const outcome = await signAccount({
      name: account.name,
      cookie: account.cookie,
      filter: config.filter,
      intervalMs: config.intervalMs,
      deps,
    });
    outcomes.push({ ...outcome, id: account.id });
    forumsAfter[account.id] = await fetchFollowedForums({ cookie: account.cookie, deps });
  }
  return { outcomes, forumsAfter };
}

/** 最后一条投递结果(结果消息);没有投递时给 null。 */
export const lastDelivery = (deliveries) => deliveries[deliveries.length - 1] ?? null;

/** 发送失败不能静默:逐条写进日志,让没有通知渠道时也能在日志里看到。 */
export function warnFailedDeliveries(log, deliveries) {
  for (const delivery of deliveries) {
    if (delivery?.ok === false) log(`[警告] 消息发送失败 · ${delivery.error ?? '未知原因'}`);
  }
}

/** 历史里只存渲染需要的字段,不把逐吧结果整份写进去。 */
export const trimAccounts = (outcomes) =>
  outcomes.map(({ id, name, ok, counts, error, reason, emptyForums, incompleteForums }) => ({
    id,
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
