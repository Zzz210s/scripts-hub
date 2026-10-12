// Task 5 的多账号用例:逐账号判定、账号名并集、映射缺条目 / 条目形状不对、屏蔽吧按账号归属,
// 以及修复轮 1 的 Important 1 —— 已确证的漏签必须压过「另一账号列表取不到」这个未知。
import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcile } from '../src/verify.js';
import { account, entry, forum, list, listFailed } from './verify-helpers.js';

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
    entry('alice'),
    entry('bob', { ok: false, reason: 'missing', reasons: ['missing'], missing: ['吧一'] }),
  ]);
});

test('reconcile:已确证的漏签压过未知 -> ok:false,reason 与 reasons 都保留信息', () => {
  const out = reconcile({
    forumsAfter: {
      alice: list([forum('吧一')]),
      bob: listFailed('未登录或凭据已失效', 'auth'),
    },
    resultsByAccount: { alice: account('alice'), bob: account('bob') },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'missing');
  assert.deepEqual(out.reasons, ['missing', 'list-failed']);
  assert.equal(out.missingTotal, 1);
  assert.deepEqual(out.unresolvedAccounts, ['bob']);
  assert.equal(out.error, '未登录或凭据已失效');
  assert.deepEqual(out.perAccount, [
    entry('alice', { ok: false, reason: 'missing', reasons: ['missing'], missing: ['吧一'] }),
    entry('bob', { ok: null, reason: 'list-failed', reasons: ['list-failed'] }),
  ]);
});

test('reconcile:全部账号列表都取不到 -> ok:null(没有任何已确证的失败)', () => {
  const out = reconcile({
    forumsAfter: { alice: listFailed('凭据失效', 'auth'), bob: listFailed('HTTP 503', 'http') },
    resultsByAccount: { alice: account('alice'), bob: account('bob') },
  });
  assert.equal(out.ok, null);
  assert.equal(out.reason, 'list-failed');
  assert.deepEqual(out.unresolvedAccounts, ['alice', 'bob']);
  assert.equal(out.error, '凭据失效');
});

test('reconcile:单个共享列表应用于所有账号', () => {
  const out = reconcile({
    forumsAfter: list([forum('吧一', { isSign: true })]),
    resultsByAccount: { alice: account('alice'), bob: account('bob') },
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.perAccount, [entry('alice'), entry('bob')]);
});

test('reconcile:映射缺某账号条目 -> 该账号标 ok:null,整体 ok:null', () => {
  const out = reconcile({
    forumsAfter: { alice: list([forum('吧一', { isSign: true })]) },
    resultsByAccount: { alice: account('alice'), bob: account('bob') },
  });
  assert.equal(out.ok, null);
  assert.deepEqual(out.unresolvedAccounts, ['bob']);
  assert.ok(out.error.includes('bob'));
  assert.equal(out.perAccount[0].ok, true);
  assert.equal(out.perAccount[1].ok, null);
});

test('reconcile:映射条目形状不对 -> 不当通过,带形状不可用的说明', () => {
  const out = reconcile({
    forumsAfter: { alice: list([forum('吧一', { isSign: true })]), bob: 'not-a-list' },
    resultsByAccount: { alice: account('alice'), bob: account('bob') },
  });
  assert.equal(out.ok, null);
  assert.equal(out.error, '对账列表形状不可用');
  assert.deepEqual(out.unresolvedAccounts, ['bob']);
});

test('reconcile:列表映射里多出的账号也计入并集', () => {
  const out = reconcile({
    forumsAfter: {
      alice: list([forum('吧一', { isSign: true })]),
      carol: list([forum('吧一')]),
    },
    resultsByAccount: { alice: account('alice') },
  });
  assert.deepEqual(out.perAccount.map((a) => a.name), ['alice', 'carol']);
  assert.equal(out.ok, false);
  assert.equal(out.missingTotal, 1);
});

test('reconcile:多账号中某账号含屏蔽吧 -> 只有该账号记 blocked,不影响别的账号', () => {
  const out = reconcile({
    forumsAfter: {
      alice: list([forum('吧一', { isSign: true }), forum('屏蔽吧', { isForbidden: true })]),
      bob: list([forum('吧一')]),
    },
    resultsByAccount: { alice: account('alice'), bob: account('bob') },
  });
  assert.equal(out.ok, false);
  assert.equal(out.blockedTotal, 1);
  assert.deepEqual(out.perAccount, [
    entry('alice', { blocked: ['屏蔽吧'] }),
    entry('bob', { ok: false, reason: 'missing', reasons: ['missing'], missing: ['吧一'] }),
  ]);
});
