// Task 5:第二层对账 —— 「今天到底签全了没有」的唯一权威口径。
//
// 纯函数:不做任何 I/O。关注列表(is_sign 读回)由调用方在签完后取好传进来;
// 本文件只比对两份数据,不自己发请求、不读时钟、不写文件。
//
// 判定口径(设计文档「对账口径的三个例外」):
//   1. isForbidden(被屏蔽/不可用)的吧排除在对账集合之外,记入 blocked —— 否则关注列表里
//      只要有一个这种吧,「全部已签」永远不成立、当天永远锁不上。
//   2. 对账集合 = 关注列表 ∩ expected(可选的白名单/谓词)− 不可签集合。expected 省略 =
//      全部已关注吧(v1 口径);它保证「只签部分吧」时未选中的吧不会被判 missing。
//   3. is_sign 是权威:第一层说成功但读回没签 = missing;第一层说失败但读回已签 = 通过。
//      resultsByAccount 只用来确定「要对哪几个账号逐条报告」,不参与 is_sign 判定。
//
// 绝不静默通过:列表请求失败 -> ok:null(未知);列表截断、关注 0 个吧、expected 选空 ->
// ok:false 并各带一个标记字段;任一吧未签 -> ok:false。

// expected 与 signAccount 的 filter 用同一个 selectForums,保证「Task 9 把同一个过滤规则
// 原样传给两边」时两处选中的吧逐条一致(含「类型写错 = 不过滤」这条既有约定)。
import { selectForums } from './account.js';

/** 对账结论的原因取值。下游按此机器可读地区分,不必匹配散文。 */
export const RECONCILE_REASON = Object.freeze({
  OK: 'ok',
  MISSING: 'missing',
  TRUNCATED: 'truncated',
  EMPTY_FORUMS: 'empty-forums',
  EXPECTED_EMPTY: 'expected-empty',
  LIST_FAILED: 'list-failed',
  NO_ACCOUNTS: 'no-accounts',
});

const R = RECONCILE_REASON;

/** 单个列表项是否长得像 fetchFollowedForums 的返回。 */
function isListResult(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ('forums' in value || 'ok' in value)
  );
}

/**
 * 取某账号的对账列表。`forumsAfter` 两种形态都收:
 *   - 单个列表结果   -> 所有账号共用这一份(设计文档写「重新取一次」时的形态)
 *   - 按账号名的映射 -> 每个账号各自的读回列表(设计文档「每个账号多一次列表请求」)
 * 取不到(缺条目 / 形状不对)返回 null,由调用方判为「未知」。
 */
function listFor(forumsAfter, name) {
  if (isListResult(forumsAfter)) return forumsAfter;
  if (forumsAfter === null || typeof forumsAfter !== 'object' || Array.isArray(forumsAfter)) {
    return null;
  }
  const entry = forumsAfter[name];
  if (entry === undefined || entry === null) return null;
  if (isListResult(entry)) return entry;
  return { ok: false, forums: null, count: 0, hasMore: false, error: '对账列表形状不可用', reason: 'parse' };
}

/** 账号名集合:两份数据的键的并集(列表映射里多出的账号也要报)。 */
function accountNames(resultsByAccount, forumsAfter) {
  const names = new Set();
  if (resultsByAccount !== null && typeof resultsByAccount === 'object' && !Array.isArray(resultsByAccount)) {
    for (const name of Object.keys(resultsByAccount)) names.add(name);
  }
  if (
    forumsAfter !== null &&
    typeof forumsAfter === 'object' &&
    !Array.isArray(forumsAfter) &&
    !isListResult(forumsAfter)
  ) {
    for (const name of Object.keys(forumsAfter)) names.add(name);
  }
  return [...names];
}

/** 统一出口:除判定结果外的标记字段一律给出确定值(false 表示没这个情况)。 */
function outcome(fields) {
  return {
    truncated: false,
    emptyForums: false,
    expectedEmpty: false,
    error: null,
    ...fields,
  };
}

/**
 * 第二层对账。
 *
 * @param {{
 *   forumsAfter: object,          // fetchFollowedForums 的返回;单个或按账号名的映射
 *   resultsByAccount: object,     // 键为账号名(signAccount 结果或它的 results 数组)
 *   expected?: ((forum: object) => boolean) | Array<string> | Set<string>,
 * }} [input]
 * @returns {{ ok: boolean|null, perAccount: Array<{name: string, missing: Array, blocked: Array}>,
 *   missingTotal: number, blockedTotal: number, truncated: boolean, emptyForums: boolean,
 *   expectedEmpty: boolean, reason: string, error: string|null }}
 */
export function reconcile({ forumsAfter, resultsByAccount, expected } = {}) {
  const names = accountNames(resultsByAccount, forumsAfter);
  if (names.length === 0) {
    return outcome({
      ok: false,
      perAccount: [],
      missingTotal: 0,
      blockedTotal: 0,
      reason: R.NO_ACCOUNTS,
      error: '没有可对账的账号',
    });
  }

  const perAccount = [];
  let missingTotal = 0;
  let blockedTotal = 0;
  let truncated = false;
  let emptyForums = false;
  let expectedEmpty = false;
  let unknown = null;

  for (const name of names) {
    const list = listFor(forumsAfter, name);
    if (list === null || list.ok !== true) {
      // 查不到 = 未知,绝不当通过。保留第一条失败原因,其余账号照常报告。
      if (unknown === null) {
        unknown = (list && list.error) || `账号 ${name} 没有可用的对账列表`;
      }
      perAccount.push({ name, missing: [], blocked: [] });
      continue;
    }
    const forums = Array.isArray(list.forums) ? list.forums : [];
    if (list.hasMore === true) truncated = true;
    if (forums.length === 0) emptyForums = true;

    const wanted = selectForums(forums, expected);
    // 只有「本来有关注吧、却被 expected 全排除」才算白名单选空;列表本身就是空的走 emptyForums。
    if (forums.length > 0 && wanted.length === 0) expectedEmpty = true;

    const missing = [];
    const blocked = [];
    for (const forum of wanted) {
      if (forum !== null && typeof forum === 'object' && forum.isForbidden === true) {
        blocked.push(forum.kw);
      } else if (forum === null || typeof forum !== 'object' || forum.isSign !== true) {
        missing.push(forum !== null && typeof forum === 'object' ? forum.kw : forum);
      }
    }
    missingTotal += missing.length;
    blockedTotal += blocked.length;
    perAccount.push({ name, missing, blocked });
  }

  let ok;
  let reason;
  if (unknown !== null) {
    ok = null;
    reason = R.LIST_FAILED;
  } else if (truncated) {
    ok = false;
    reason = R.TRUNCATED;
  } else if (emptyForums) {
    ok = false;
    reason = R.EMPTY_FORUMS;
  } else if (expectedEmpty) {
    ok = false;
    reason = R.EXPECTED_EMPTY;
  } else if (missingTotal > 0) {
    ok = false;
    reason = R.MISSING;
  } else {
    ok = true;
    reason = R.OK;
  }

  return outcome({ ok, perAccount, missingTotal, blockedTotal, truncated, emptyForums, expectedEmpty, reason, error: unknown });
}
