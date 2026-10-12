// Task 5:第二层对账的纯函数测试。全部离线:关注列表与账号结果都是手写的字面量。
// 对账是「今天到底签全了没有」的唯一权威口径,所以这里的用例重点是「不许静默通过」。

import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcile } from '../src/verify.js';

/** 关注列表里的一条。默认未签、未屏蔽。 */
const forum = (kw, { isSign = false, isForbidden = false, fid = kw } = {}) => ({
  fid,
  kw,
  isSign,
  isForbidden,
});

/** fetchFollowedForums 的成功返回。 */
const list = (forums, extra = {}) => ({
  ok: true,
  forums,
  count: forums.length,
  hasMore: false,
  error: null,
  reason: 'ok',
  ...extra,
});

/** 对账列表请求失败的返回(形状同 fetchFollowedForums 的失败分支)。 */
const listFailed = (error, reason) => ({
  ok: false,
  forums: null,
  count: 0,
  hasMore: false,
  error,
  reason,
});

/** signAccount 的返回(reconcile 只用键确定账号名,值不参与 is_sign 判定)。 */
const account = (name) => ({ name, ok: true, results: [], counts: {}, error: null, reason: 'ok' });

test('reconcile:全部 isSign 为真 -> ok:true', () => {
  const out = reconcile({
    forumsAfter: list([forum('吧一', { isSign: true }), forum('吧二', { isSign: true })]),
    resultsByAccount: { alice: account('alice') },
  });
  assert.equal(out.ok, true);
  assert.equal(out.reason, 'ok');
  assert.equal(out.missingTotal, 0);
  assert.deepEqual(out.perAccount, [{ name: 'alice', missing: [], blocked: [] }]);
});

test('reconcile:某吧未签 -> ok:false 且列出 kw', () => {
  const out = reconcile({
    forumsAfter: list([forum('吧一', { isSign: true }), forum('吧二')]),
    resultsByAccount: { alice: account('alice') },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'missing');
  assert.deepEqual(out.perAccount[0].missing, ['吧二']);
  assert.equal(out.missingTotal, 1);
});

test('reconcile:isForbidden 的吧不计入 missing、记入 blocked,且不阻止锁定', () => {
  const out = reconcile({
    forumsAfter: list([
      forum('吧一', { isSign: true }),
      forum('屏蔽吧', { isForbidden: true, isSign: false }),
    ]),
    resultsByAccount: { alice: account('alice') },
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.perAccount[0].missing, []);
  assert.deepEqual(out.perAccount[0].blocked, ['屏蔽吧']);
  assert.equal(out.blockedTotal, 1);
});

test('reconcile:对账请求失败 -> ok:null 并带原因(不把「查不到」当通过)', () => {
  const out = reconcile({
    forumsAfter: listFailed('关注列表 HTTP 503', 'http'),
    resultsByAccount: { alice: account('alice') },
  });
  assert.equal(out.ok, null);
  assert.equal(out.reason, 'list-failed');
  assert.ok(out.error);
});

test('reconcile:hasMore 截断 -> ok 绝不为 true,且带 truncated', () => {
  const out = reconcile({
    forumsAfter: list([forum('吧一', { isSign: true })], { hasMore: true }),
    resultsByAccount: { alice: account('alice') },
  });
  assert.notEqual(out.ok, true);
  assert.equal(out.ok, false);
  assert.equal(out.truncated, true);
  assert.equal(out.reason, 'truncated');
});

test('reconcile:关注 0 个吧 -> ok 不为 true,且带 emptyForums', () => {
  const out = reconcile({
    forumsAfter: list([]),
    resultsByAccount: { alice: account('alice') },
  });
  assert.notEqual(out.ok, true);
  assert.equal(out.emptyForums, true);
  assert.equal(out.expectedEmpty, false);
  assert.equal(out.reason, 'empty-forums');
});

test('reconcile:expected 白名单外的吧不判 missing', () => {
  const out = reconcile({
    forumsAfter: list([forum('要签的吧', { isSign: true }), forum('没选中的吧')]),
    resultsByAccount: { alice: account('alice') },
    expected: ['要签的吧'],
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.perAccount[0].missing, []);
});

test('reconcile:expected 谓词同义', () => {
  const out = reconcile({
    forumsAfter: list([forum('a', { isSign: true }), forum('b')]),
    resultsByAccount: { alice: account('alice') },
    expected: (f) => f.kw === 'a',
  });
  assert.equal(out.ok, true);
});

test('reconcile:expected 匹配 0 个吧 -> ok:false,白名单写错不静默通过', () => {
  const out = reconcile({
    forumsAfter: list([forum('吧一', { isSign: true })]),
    resultsByAccount: { alice: account('alice') },
    expected: ['不存在的吧'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.expectedEmpty, true);
});

test('reconcile:按账号名各传一份关注列表 -> 逐账号判定', () => {
  const out = reconcile({
    forumsAfter: {
      alice: list([forum('吧一', { isSign: true })]),
      bob: list([forum('吧一')]),
    },
    resultsByAccount: { alice: account('alice'), bob: account('bob') },
  });
  assert.equal(out.ok, false);
  assert.equal(out.missingTotal, 1);
  assert.deepEqual(out.perAccount, [
    { name: 'alice', missing: [], blocked: [] },
    { name: 'bob', missing: ['吧一'], blocked: [] },
  ]);
});

test('reconcile:任一账号列表查不到 -> ok:null(未知,不当通过)', () => {
  const out = reconcile({
    forumsAfter: {
      alice: list([forum('吧一')]),
      bob: listFailed('未登录或凭据已失效', 'auth'),
    },
    resultsByAccount: { alice: account('alice'), bob: account('bob') },
  });
  assert.equal(out.ok, null);
  assert.ok(out.error);
});

test('reconcile:单个共享列表应用于所有账号', () => {
  const out = reconcile({
    forumsAfter: list([forum('吧一', { isSign: true })]),
    resultsByAccount: { alice: account('alice'), bob: account('bob') },
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.perAccount.map((a) => a.name), ['alice', 'bob']);
});

test('reconcile:没有账号 -> ok:false(不静默通过)', () => {
  const out = reconcile({ forumsAfter: list([]), resultsByAccount: {} });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-accounts');
});

test('reconcile:纯函数,不改动入参', () => {
  const after = Object.freeze(list(Object.freeze([Object.freeze(forum('吧一'))])));
  const results = Object.freeze({ alice: Object.freeze(account('alice')) });
  const out = reconcile({ forumsAfter: after, resultsByAccount: results });
  assert.equal(out.ok, false);
  assert.equal(after.forums.length, 1);
});
