// 单账号签到流程:取 tbs -> 取关注列表 -> 逐吧串行签到(吧与吧之间 sleep)-> 账号级汇总。
//
// 本文件不碰传输细节,三个请求全部走 ./client.js;不抛异常,失败归一为返回值。
// 两条关键约定(控制者裁决):
//   1. 只有真的拿到 `tbs-stale` 才重取 tbs,且**全文只重取一次**(不逐吧重取);
//   2. 凭据失效要机器可读地带出来:账号结果带 `reason`(取值同 client 的集合),
//      Task 9 据此推 action,不必匹配中文散文。
//
// `ok` 的含义是「流程完整跑完」,不是「全部签成」—— 逐吧结论看 results/counts,
// 整体是否算完成由 Task 5 的第二层对账(`is_sign` 读回)定,本文件不越权判定。

import { fetchFollowedForums, fetchTbs, signForum } from './client.js';
import { SIGN_STATUS, statusCountsKey } from './sign.js';

const DEFAULT_INTERVAL_MS = 2000;

/** 默认 sleep;测试用 `deps.sleep` 注入 0 并计数,绝不真实等待。 */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const COUNT_KEYS = ['signed', 'already', 'blocked', 'tbsStale', 'failed'];

/** 五个计数键都在,初值 0。 */
function emptyCounts() {
  return Object.fromEntries(COUNT_KEYS.map((key) => [key, 0]));
}

/** 账号级失败(连启动都没做到):保留已得结果与计数。 */
function fatal(name, results, counts, error, reason) {
  return { name, ok: false, results, counts, error, reason };
}

/** 记一条逐吧结果并同步计数。 */
function record(results, counts, kw, status) {
  results.push({ kw, status });
  counts[statusCountsKey(status)] += 1;
}

/**
 * 把配置过滤规则套到关注列表上。`filter` 允许三种形态:
 *   - 省略 / null -> 全部保留
 *   - 函数        -> 谓词,入参是 `{ fid, kw, isSign, isForbidden }`
 *   - 数组 / Set  -> 目标吧名白名单(按 kw 命中)
 */
export function selectForums(forums, filter) {
  if (filter === undefined || filter === null) return forums;
  if (typeof filter === 'function') return forums.filter((forum) => filter(forum));
  const wanted = new Set(filter);
  return forums.filter((forum) => wanted.has(forum.kw));
}

/**
 * 单账号签到。
 *
 * @param {{ name?: string, cookie?: string,
 *           filter?: ((forum: object) => boolean) | Array<string> | Set<string>,
 *           intervalMs?: number, deps?: object }} [input]
 * @returns {Promise<{ name: string, ok: boolean, results: Array<{kw: unknown, status: string}>,
 *   counts: { signed: number, already: number, blocked: number, tbsStale: number, failed: number },
 *   error: string|null, reason: string, emptyForums?: boolean, incompleteForums?: boolean }>}
 */
export async function signAccount({ name, cookie, filter, intervalMs, deps } = {}) {
  const sleep = deps?.sleep ?? defaultSleep;
  const waitMs = intervalMs ?? DEFAULT_INTERVAL_MS;
  const counts = emptyCounts();
  const results = [];

  const first = await fetchTbs({ cookie, deps });
  if (!first.ok) return fatal(name, results, counts, first.error, first.reason);
  let tbs = first.tbs;

  const list = await fetchFollowedForums({ cookie, deps });
  if (!list.ok) return fatal(name, results, counts, list.error, list.reason);

  const targets = selectForums(list.forums ?? [], filter);
  let refreshed = false;

  for (let index = 0; index < targets.length; index += 1) {
    if (index > 0) await sleep(waitMs);
    const forum = targets[index];
    let outcome = await signForum({ cookie, forum, tbs, deps });
    if (outcome.status === SIGN_STATUS.TBS_STALE && !refreshed) {
      refreshed = true;
      const again = await fetchTbs({ cookie, deps });
      if (!again.ok) {
        record(results, counts, forum.kw, SIGN_STATUS.TBS_STALE);
        return fatal(name, results, counts, again.error, again.reason);
      }
      tbs = again.tbs;
      outcome = await signForum({ cookie, forum, tbs, deps });
    }
    record(results, counts, forum.kw, outcome.status);
  }

  const summary = { name, ok: true, results, counts, error: null, reason: 'ok' };
  // 两个下游必须区分的取值(见 client.js 注释):空列表可能读不到、hasMore 表示列表不全。
  if (list.count === 0) summary.emptyForums = true;
  if (list.hasMore) summary.incompleteForums = true;
  return summary;
}
