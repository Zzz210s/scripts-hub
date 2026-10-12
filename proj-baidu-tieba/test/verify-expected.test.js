// Task 5 的 expected / 白名单用例。核心点:白名单写错要 fail-closed,但「某账号没关注
// 白名单里的任何吧」是合法配置,不能让它把整轮永久锁不上(修复轮 1 的 Important 2)。
import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcile } from '../src/verify.js';
import { account, entry, forum, list } from './verify-helpers.js';

test('reconcile:expected 白名单外的吧不判 missing', () => {
  const out = reconcile({
    forumsAfter: list([forum('要签的吧', { isSign: true }), forum('没选中的吧')]),
    resultsByAccount: { alice: account('alice') },
    expected: ['要签的吧'],
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.perAccount, [entry('alice')]);
});

test('reconcile:expected 谓词同义', () => {
  const out = reconcile({
    forumsAfter: list([forum('a', { isSign: true }), forum('b')]),
    resultsByAccount: { alice: account('alice') },
    expected: (f) => f.kw === 'a',
  });
  assert.equal(out.ok, true);
});

test('reconcile:只有一个账号且 expected 匹配 0 个吧 -> ok:false,白名单写错不静默通过', () => {
  const out = reconcile({
    forumsAfter: list([forum('吧一', { isSign: true })]),
    resultsByAccount: { alice: account('alice') },
    expected: ['不存在的吧'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.expectedEmpty, true);
  assert.equal(out.reason, 'expected-empty');
});

test('reconcile:多账号时任一账号的 wanted 非空即不算 expectedEmpty -> ok:true', () => {
  const out = reconcile({
    forumsAfter: {
      alice: list([forum('m', { isSign: true })]),
      bob: list([forum('b', { isSign: true })]),
    },
    resultsByAccount: { alice: account('alice'), bob: account('bob') },
    expected: (f) => f.kw === 'b',
  });
  assert.equal(out.expectedEmpty, false);
  assert.equal(out.ok, true);
  assert.deepEqual(out.perAccount, [entry('alice'), entry('bob')]);
  assert.equal(out.missingTotal, 0);
});

test('reconcile:全部账号的 wanted 并集为空才判 expectedEmpty', () => {
  const out = reconcile({
    forumsAfter: {
      alice: list([forum('m', { isSign: true })]),
      bob: list([forum('n', { isSign: true })]),
    },
    resultsByAccount: { alice: account('alice'), bob: account('bob') },
    expected: ['不存在的吧'],
  });
  assert.equal(out.expectedEmpty, true);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'expected-empty');
});
