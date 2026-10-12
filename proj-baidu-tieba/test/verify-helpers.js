// verify*.test.js 共用的字面量构造器(不匹配 *.test.js,不会被 node --test 当用例跑)。
// 全部离线:关注列表与账号结果都是手写字面量,形状取自 ../src/client.js 的现有返回。

/** 关注列表里的一条。默认未签、未屏蔽。 */
export const forum = (kw, { isSign = false, isForbidden = false, fid = kw } = {}) => ({
  fid,
  kw,
  isSign,
  isForbidden,
});

/** fetchFollowedForums 的成功返回。 */
export const list = (forums, extra = {}) => ({
  ok: true,
  forums,
  count: forums.length,
  hasMore: false,
  error: null,
  reason: 'ok',
  ...extra,
});

/** 对账列表请求失败的返回(形状同 fetchFollowedForums 的失败分支)。 */
export const listFailed = (error, reason) => ({
  ok: false,
  forums: null,
  count: 0,
  hasMore: false,
  error,
  reason,
});

/** signAccount 的返回(reconcile 只用键确定账号名,值不参与 is_sign 判定)。 */
export const account = (name) => ({ name, ok: true, results: [], counts: {}, error: null, reason: 'ok' });

/** 期望的 perAccount 条目。 */
export const entry = (name, extra = {}) => ({
  name,
  ok: true,
  reason: 'ok',
  reasons: ['ok'],
  missing: [],
  blocked: [],
  ...extra,
});
