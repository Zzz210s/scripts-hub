// messages*.test.js 共用的字面量构造器(不匹配 *.test.js,不会被 node --test 当用例跑)。
// 形状照 Task 8 brief 钉死的 ctx:`{ date, accounts, reconcile, reason, exitCode, dryRun }`。
// 全部离线,纯字符串断言。

/** signAccount 的返回补齐所有计数键(缺键测试另写,不在这里悄悄填)。 */
export const account = (name, counts = {}, extra = {}) => ({
  name,
  ok: true,
  counts: { signed: 0, already: 0, blocked: 0, tbsStale: 0, failed: 0, ...counts },
  error: null,
  reason: 'ok',
  ...extra,
});

/** reconcile.perAccount 的一条。 */
export const entry = (name, extra = {}) => ({
  name,
  ok: true,
  reason: 'ok',
  reasons: ['ok'],
  missing: [],
  blocked: [],
  ...extra,
});

/** reconcile() 的返回,默认「全部已签」。 */
export const reconcile = (extra = {}) => ({
  ok: true,
  missingTotal: 0,
  blockedTotal: 0,
  truncated: false,
  emptyForums: false,
  expectedEmpty: false,
  unresolvedAccounts: [],
  reasons: ['ok'],
  reason: 'ok',
  error: null,
  perAccount: [entry('alice')],
  ...extra,
});

/** 默认 ctx:单账号 alice,对账通过。 */
export const ctx = (extra = {}) => ({
  date: '2026-10-11',
  accounts: [account('alice', { signed: 12, already: 3, blocked: 1 })],
  reconcile: reconcile(),
  exitCode: 0,
  dryRun: false,
  ...extra,
});
