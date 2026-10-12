// Task 5 的标签回落用例:kw 拿不到时绝不能把 null / undefined 写进面向用户的消息,
// 退到 fid;连 fid 都没有时给固定说明。文案一律不用圆括号。
import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcile } from '../src/verify.js';
import { account, forum, list } from './verify-helpers.js';

const missingOf = (forums) =>
  reconcile({ forumsAfter: list(forums), resultsByAccount: { alice: account('alice') } })
    .perAccount[0].missing;

test('reconcile:kw 为 null 时回落 fid', () => {
  const missing = missingOf([{ fid: 42, kw: null, isSign: false, isForbidden: false }]);
  assert.deepEqual(missing, ['fid:42']);
  assert.ok(!missing.join().includes('null'));
});

test('reconcile:kw 为空字符串时回落 fid,屏蔽吧同理', () => {
  const out = reconcile({
    forumsAfter: list([
      { fid: 7, kw: '', isSign: false, isForbidden: false },
      { fid: 8, kw: null, isSign: false, isForbidden: true },
    ]),
    resultsByAccount: { alice: account('alice') },
  });
  assert.deepEqual(out.perAccount[0].missing, ['fid:7']);
  assert.deepEqual(out.perAccount[0].blocked, ['fid:8']);
});

test('reconcile:kw 与 fid 都拿不到、条目不是对象 -> 固定可读说明', () => {
  const missing = missingOf([{ isSign: false }, null, '字符串条目']);
  assert.deepEqual(missing, ['未知吧 fid 缺失', '未知吧', '字符串条目']);
  assert.ok(!/[()]/.test(missing.join('/')));
});
