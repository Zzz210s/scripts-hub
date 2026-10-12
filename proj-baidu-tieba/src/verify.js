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
// 三态:true = 已确证全签且无异常;false = 已确证不能锁当天;null = 无法判定。
// **已确证的失败优先于未知**:某账号列表取不到、另一账号确有漏签时给 false,不给 null ——
// 单个账号凭据失效不能把整轮判死,下游必须看到确有漏签。
//
// 绝不静默通过:列表请求失败 -> ok:null(仅当没有任何已确证的失败);列表截断、关注 0 个吧、
// 全部账号的 expected 并集选空 -> ok:false;任一吧未签 -> ok:false。

import { selectForums } from './account.js';
import { accountNames, isRecord, labelOf, listFor } from './verify-input.js';

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

/** 统一出口:除判定结果外的标记字段一律给出确定值(false / 空数组表示没这个情况)。 */
function outcome(fields) {
  return {
    truncated: false,
    emptyForums: false,
    expectedEmpty: false,
    unresolvedAccounts: [],
    error: null,
    ...fields,
  };
}

/** 逐吧分拣:屏蔽的记 blocked,其余按 is_sign 严格为 true 记 missing。 */
function split(wanted) {
  const missing = [];
  const blocked = [];
  for (const forum of wanted) {
    if (isRecord(forum) && forum.isForbidden === true) {
      blocked.push(labelOf(forum));
    } else if (!isRecord(forum) || forum.isSign !== true) {
      missing.push(labelOf(forum));
    }
  }
  return { missing, blocked };
}

/** 标记位 -> 原因列表(固定优先级;第一个即主原因,数组本身不丢信息)。 */
function reasonsOf(flags) {
  const reasons = [];
  if (flags.truncated) reasons.push(R.TRUNCATED);
  if (flags.emptyForums) reasons.push(R.EMPTY_FORUMS);
  if (flags.expectedEmpty) reasons.push(R.EXPECTED_EMPTY);
  if (flags.missingTotal > 0) reasons.push(R.MISSING);
  if (flags.unresolved) reasons.push(R.LIST_FAILED);
  return reasons;
}

/**
 * 第二层对账。
 *
 * @param {{
 *   forumsAfter: object,      // fetchFollowedForums 的返回:单个结果,或「对象,键为账号名」的映射
 *   resultsByAccount: object, // **对象**,键为账号名(值不参与 is_sign 判定;传数组键会变成 "0"/"1")
 *   expected?: ((forum: object) => boolean) | Array<string> | Set<string>,
 * }} [input]
 * @returns {{ ok: boolean|null, perAccount: Array<{name: string, ok: boolean|null, reason: string,
 *   reasons: Array<string>, missing: Array, blocked: Array}>, missingTotal: number,
 *   blockedTotal: number, truncated: boolean, emptyForums: boolean, expectedEmpty: boolean,
 *   reason: string, reasons: Array<string>, unresolvedAccounts: Array<string>, error: string|null }}
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
      reasons: [R.NO_ACCOUNTS],
      error: '没有可对账的账号',
    });
  }

  const perAccount = [];
  const wantedUnion = new Set();
  const unresolvedAccounts = [];
  let missingTotal = 0;
  let blockedTotal = 0;
  let nonEmptyLists = 0;
  let truncated = false;
  let emptyForums = false;
  let error = null;

  for (const name of names) {
    const list = listFor(forumsAfter, name);
    if (list === null || list.ok !== true) {
      // 查不到 = 未知。保留第一条失败说明,其余账号照常报告,该账号单独标 ok:null。
      if (error === null) error = (list && list.error) || `账号 ${name} 没有可用的对账列表`;
      unresolvedAccounts.push(name);
      perAccount.push({ name, ok: null, reason: R.LIST_FAILED, reasons: [R.LIST_FAILED], missing: [], blocked: [] });
      continue;
    }
    const forums = Array.isArray(list.forums) ? list.forums : [];
    const isTruncated = list.hasMore === true;
    if (isTruncated) truncated = true;
    if (forums.length === 0) emptyForums = true;
    else nonEmptyLists += 1;

    const wanted = selectForums(forums, expected);
    for (const forum of wanted) wantedUnion.add(isRecord(forum) ? forum.kw : forum);

    const { missing, blocked } = split(wanted);
    missingTotal += missing.length;
    blockedTotal += blocked.length;

    // 单账号的 wanted 为空不算失败(该账号没关注白名单里的吧,合法配置);
    // 只有「所有账号的 wanted 并集都为空」才是白名单写错,见下面的 expectedEmpty。
    const reasons = reasonsOf({
      truncated: isTruncated,
      emptyForums: forums.length === 0,
      expectedEmpty: false,
      missingTotal: missing.length,
      unresolved: false,
    });
    perAccount.push({
      name,
      ok: reasons.length === 0,
      reason: reasons.length === 0 ? R.OK : reasons[0],
      reasons: reasons.length === 0 ? [R.OK] : reasons,
      missing,
      blocked,
    });
  }

  const expectedEmpty = nonEmptyLists > 0 && wantedUnion.size === 0;
  const reasons = reasonsOf({
    truncated,
    emptyForums,
    expectedEmpty,
    missingTotal,
    unresolved: unresolvedAccounts.length > 0,
  });

  const knownBad = truncated || emptyForums || expectedEmpty || missingTotal > 0;
  let ok;
  let reason;
  if (knownBad) {
    ok = false;
    reason = reasons[0];
  } else if (reasons.length > 0) {
    ok = null;
    reason = R.LIST_FAILED;
  } else {
    ok = true;
    reason = R.OK;
    reasons.push(R.OK);
  }

  return outcome({
    ok,
    perAccount,
    missingTotal,
    blockedTotal,
    truncated,
    emptyForums,
    expectedEmpty,
    reason,
    reasons,
    unresolvedAccounts,
    error: unresolvedAccounts.length > 0 ? error : null,
  });
}
