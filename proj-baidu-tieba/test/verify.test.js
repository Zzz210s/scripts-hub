// Task 5 核心对账用例:全签 / 漏签 / 屏蔽吧 / 列表取不到 / 截断 / 空列表 / 无账号 / 纯函数。
// 对账是「今天到底签全了没有」的唯一权威口径,这里的重点全是「不许静默通过」。
// 多账号、expected 白名单、标签回落分别见 verify-accounts / verify-expected / verify-labels。
import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcile } from '../src/verify.js';
import { account, entry, forum, list, listFailed } from './verify-helpers.js';

test('reconcile:全部 isSign 为真 -> ok:true', () => {
  const out = reconcile({
    forumsAfter: list([forum('吧一', { isSign: true }), forum('吧二', { isSign: true })]),
    resultsByAccount: { alice: account('alice') },
  });
  assert.equal(out.ok, true);
  assert.equal(out.reason, 'ok');
  assert.deepEqual(out.reasons, ['ok']);
  assert.equal(out.missingTotal, 0);
  assert.deepEqual(out.perAccount, [entry('alice')]);
  assert.equal(out.error, null);
  assert.deepEqual(out.unresolvedAccounts, []);
});

test('reconcile:某吧未签 -> ok:false 且列出标签,perAccount 标明该账号未签', () => {
  const out = reconcile({
    forumsAfter: list([forum('吧一', { isSign: true }), forum('吧二')]),
    resultsByAccount: { alice: account('alice') },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'missing');
  assert.deepEqual(out.reasons, ['missing']);
  assert.deepEqual(out.perAccount[0].missing, ['吧二']);
  assert.equal(out.perAccount[0].ok, false);
  assert.equal(out.perAccount[0].reason, 'missing');
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
  assert.deepEqual(out.reasons, ['list-failed']);
  assert.equal(out.error, '关注列表 HTTP 503');
  assert.deepEqual(out.unresolvedAccounts, ['alice']);
  assert.equal(out.perAccount[0].ok, null);
  assert.equal(out.perAccount[0].reason, 'list-failed');
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

test('reconcile:没有账号 -> ok:false(不静默通过)', () => {
  const out = reconcile({ forumsAfter: list([]), resultsByAccount: {} });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-accounts');
  assert.deepEqual(out.reasons, ['no-accounts']);
});

test('reconcile:纯函数,不改动入参', () => {
  const after = Object.freeze(list(Object.freeze([Object.freeze(forum('吧一'))])));
  const results = Object.freeze({ alice: Object.freeze(account('alice')) });
  const out = reconcile({ forumsAfter: after, resultsByAccount: results });
  assert.equal(out.ok, false);
  assert.equal(after.forums.length, 1);
});
