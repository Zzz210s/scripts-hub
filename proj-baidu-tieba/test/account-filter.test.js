// Task 4:filter 形态与 selectForums 的防御。全部离线,桩与常量见 ./account-helpers.js。

import test from 'node:test';
import assert from 'node:assert/strict';

import { selectForums, signAccount } from '../src/account.js';
import { forum, makeDeps, route, sessionOk, signCalls } from './account-helpers.js';

const sessionReply = sessionOk({ forums: [forum(1, '甲'), forum(2, '乙')] });
const sign = {
  甲: { error_code: '0', user_info: { sign_bonus_point: 1 } },
  乙: { error_code: '0', user_info: { sign_bonus_point: 1 } },
};

test('signAccount:filter 谓词只签命中的吧;数组形态按吧名白名单', async () => {
  const byFn = makeDeps(route({ session: [sessionReply], sign }));
  const first = await signAccount({
    name: 'a',
    cookie: 'BDUSS=x',
    intervalMs: 0,
    deps: byFn.deps,
    filter: (f) => f.kw === '乙',
  });
  assert.deepEqual(first.results, [{ kw: '乙', status: 'signed' }]);
  assert.equal(signCalls(byFn.calls).length, 1);
  const byList = makeDeps(route({ session: [sessionReply], sign }));
  const second = await signAccount({
    name: 'a',
    cookie: 'BDUSS=x',
    intervalMs: 0,
    deps: byList.deps,
    filter: ['甲'],
  });
  assert.deepEqual(second.results, [{ kw: '甲', status: 'signed' }]);
});

test('signAccount:filter 传 Set 也按吧名白名单', async () => {
  const { deps, calls } = makeDeps(route({ session: [sessionReply], sign }));
  const r = await signAccount({
    name: 'a',
    cookie: 'BDUSS=x',
    intervalMs: 0,
    deps,
    filter: new Set(['甲']),
  });
  assert.deepEqual(r.results, [{ kw: '甲', status: 'signed' }]);
  assert.equal(signCalls(calls).length, 1);
});

test('selectForums:省略 filter 返回副本,不交出调用方的数组', () => {
  const src = [forum(1, '甲')];
  const out = selectForums(src);
  assert.notEqual(out, src);
  assert.deepEqual(out, src);
  out.push(forum(2, '乙'));
  assert.equal(src.length, 1);
});

test('selectForums:非数组/Set 的 filter 按无过滤处理,不退化成按字符白名单', async () => {
  const { deps, calls } = makeDeps(route({ session: [sessionReply], sign }));
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', intervalMs: 0, deps, filter: '甲乙' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map((x) => x.kw), ['甲', '乙']);
  assert.equal(signCalls(calls).length, 2);
  assert.deepEqual(selectForums([forum(1, '甲')], 42), [forum(1, '甲')]);
});
