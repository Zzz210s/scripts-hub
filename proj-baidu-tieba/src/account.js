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

import { fetchSession, signForum } from './client.js';
import { SIGN_STATUS, statusCountsKey } from './sign.js';

const DEFAULT_INTERVAL_MS = 2000;

/** 默认 sleep;测试用 `deps.sleep` 注入 0 并计数,绝不真实等待。 */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 计数键由 SIGN_STATUS 派生(加第六态自动跟上,不会静默漏键)。 */
const COUNT_KEYS = [...new Set(Object.values(SIGN_STATUS).map(statusCountsKey))];
const COUNT_KEY_SET = new Set(COUNT_KEYS);

/** 五个计数键都在,初值 0。 */
function emptyCounts() {
  return Object.fromEntries(COUNT_KEYS.map((key) => [key, 0]));
}

/**
 * 状态 -> 计数键。已知态按 `statusCountsKey` 派生(`tbs-stale` -> `tbsStale`);
 * 未知态一律归入 `failed`,不写出 `counts[未知] = NaN`。
 */
export function countKeyFor(status) {
  const key = statusCountsKey(status);
  return COUNT_KEY_SET.has(key) ? key : 'failed';
}

/**
 * 账号级失败(连启动都没做到,或中途重取 tbs 失败):保留已得结果与计数,
 * 并把列表歧义标记原样带出(中途 fatal 也不能让下游把「列表不全」当通过)。
 */
function fatal(name, results, counts, error, reason, markers) {
  return { name, ok: false, results, counts, error, reason, ...markers };
}

/** 记一条逐吧结果并同步计数。等级一并保留:明细消息要逐吧渲染 `吧名 Lv8`。 */
function record(results, counts, forum, status) {
  results.push({ kw: forum?.kw ?? null, level: forum?.level ?? null, status });
  counts[countKeyFor(status)] += 1;
}

/**
 * 把配置过滤规则套到关注列表上。`filter` 允许三种形态:
 *   - 省略 / null / 其他非白名单类型 -> 全部保留(返回的总是副本,不交出调用方数组)
 *   - 函数        -> 谓词,入参是 `{ fid, kw, isSign, isForbidden }`
 *   - 数组 / Set  -> 目标吧名白名单(按 kw 命中)
 *
 * 字符串/数字/对象一类是配置写错:按「无过滤」处理,**不**退化成「按字符白名单」
 * (那会静默选中 0 个吧却仍 `ok:true`)。本文件承诺不抛异常,故不在这里报错。
 */
export function selectForums(forums, filter) {
  const list = Array.isArray(forums) ? forums : [];
  if (typeof filter === 'function') return list.filter((forum) => filter(forum));
  if (Array.isArray(filter) || filter instanceof Set) {
    const wanted = new Set(filter);
    return list.filter((forum) => wanted.has(forum.kw));
  }
  return list.slice();
}

/**
 * 单账号签到。
 *
 * @param {{ name?: string, cookie?: string,
 *           filter?: ((forum: object) => boolean) | Array<string> | Set<string>,
 *           intervalMs?: number, deps?: object }} [input]
 * @returns {Promise<{ name: string, ok: boolean,
 *   results: Array<{kw: unknown, level: number|null, status: string}>,
 *   counts: { signed: number, already: number, blocked: number, tbsStale: number, failed: number },
 *   error: string|null, reason: string, emptyForums?: boolean, incompleteForums?: boolean }>}
 */
export async function signAccount({ name, cookie, filter, intervalMs, deps } = {}) {
  const sleep = deps?.sleep ?? defaultSleep;
  const waitMs = intervalMs ?? DEFAULT_INTERVAL_MS;
  const counts = emptyCounts();
  const results = [];

  // 会话与关注列表同源(`/mo/q/newmoindex` 一次给全),所以只请求一次:省一次往返,
  // 也不会出现「tbs 拿到了、列表拿不到」这种半吊子状态。
  const session = await fetchSession({ cookie, deps });
  if (!session.ok) return fatal(name, results, counts, session.error, session.reason);
  let tbs = session.tbs;
  const list = session;

  // 两个下游必须区分的取值(见 client.js 注释):空列表可能读不到、hasMore 表示列表不全。
  // 一拿到列表就定死,好让循环里的 fatal 也带着它们返回。
  const markers = {};
  if (list.count === 0) markers.emptyForums = true;
  if (list.hasMore) markers.incompleteForums = true;

  const targets = selectForums(list.forums ?? [], filter);
  let refreshed = false;

  for (let index = 0; index < targets.length; index += 1) {
    if (index > 0) await sleep(waitMs);
    const forum = targets[index];
    let outcome = await signForum({ cookie, forum, tbs, deps });
    if (outcome.status === SIGN_STATUS.TBS_STALE && !refreshed) {
      refreshed = true;
      // 只重取会话拿新 tbs;关注列表不再重读(重试只针对那一个吧,列表没有变)。
      const again = await fetchSession({ cookie, deps });
      if (!again.ok) {
        record(results, counts, forum, SIGN_STATUS.TBS_STALE);
        return fatal(name, results, counts, again.error, again.reason, markers);
      }
      tbs = again.tbs;
      outcome = await signForum({ cookie, forum, tbs, deps });
    }
    record(results, counts, forum, outcome.status);
  }

  return { name, ok: true, results, counts, error: null, reason: 'ok', ...markers };
}
