// Task 4:单账号签到主流程、失败路径与列表歧义标记。全部离线:fetchImpl 与 sleep 都是桩。
// 路由桩与常量在 ./account-helpers.js;tbs 重试见 ./account-retry.test.js;filter 见 ./account-filter.test.js。

import test from 'node:test';
import assert from 'node:assert/strict';

import { countKeyFor, signAccount } from '../src/account.js';
import { forum, makeDeps, json, route, sessionAuthFail, sessionOk, signCalls, SESSION, ZERO } from './account-helpers.js';

test('signAccount:逐吧状态与账号计数正确,间隔走注入 sleep', async () => {
  const sign = {
    甲: { error_code: '0', user_info: { sign_bonus_point: 12 } },
    乙: { error_code: '160002' },
    丙: { error_code: '340006' },
  };
  const { deps, calls, sleeps } = makeDeps(
    route({ session: [sessionOk({ forums: [forum(1, '甲'), forum(2, '乙'), forum(3, '丙')] })], sign }),
  );
  const r = await signAccount({ name: 'acc1', cookie: 'BDUSS=x', intervalMs: 0, deps });
  assert.equal(r.name, 'acc1');
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.equal(r.reason, 'ok');
  assert.deepEqual(r.results, [
    { kw: '甲', level: 8, status: 'signed' },
    { kw: '乙', level: 8, status: 'already' },
    { kw: '丙', level: 8, status: 'blocked' },
  ]);
  assert.deepEqual(r.counts, { signed: 1, already: 1, blocked: 1, tbsStale: 0, failed: 0 });
  assert.equal(signCalls(calls).length, 3);
  assert.deepEqual(sleeps, [0, 0]);
});

test('signAccount:凭据失效 -> ok:false 带 reason auth 与 error,不发后续请求', async () => {
  const { deps, calls } = makeDeps(route({ session: [sessionAuthFail()] }));
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', intervalMs: 0, deps });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'auth');
  assert.ok(r.error);
  assert.deepEqual(r.results, []);
  assert.deepEqual(r.counts, ZERO);
  assert.equal(calls.length, 1);
});

test('signAccount:cookie 里没有 BDUSS -> reason no-cookie 且零请求', async () => {
  const { deps, calls } = makeDeps(route({}));
  const r = await signAccount({ name: 'a', cookie: 'STOKEN=x', deps });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-cookie');
  assert.ok(r.error);
  assert.equal(calls.length, 0);
});

test('signAccount:会话请求传输失败 -> ok:false 带传输层原因', async () => {
  // 会话与关注列表现在是同一个请求;它失败就等于「拿不到列表」。
  const { deps } = makeDeps(() => ({ status: 503, text: 'down' }));
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', deps });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'http');
  assert.equal(r.results.length, 0);
});

test('signAccount:关注 0 个吧不当作全部已签,标 emptyForums', async () => {
  const { deps, calls } = makeDeps(route({ session: [sessionOk({ forums: [] })] }));
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', deps });
  assert.equal(r.ok, true);
  assert.equal(r.emptyForums, true);
  assert.deepEqual(r.results, []);
  assert.equal(signCalls(calls).length, 0);
});

test('signAccount:关注列表是单次全量返回,不带 incompleteForums 标记', async () => {
  // 2026-10-14 起 like_forum 一次给全(真机 134 个吧一次返回),不存在翻页;
  // 所以「列表不全」这个标记不会再出现,而空列表仍然单独标出来。
  const { deps } = makeDeps(route({ session: [sessionOk({ forums: [forum(1, '甲')] })], sign: { 甲: { error_code: '0', user_info: { sign_bonus_point: 1 } } } }));
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', intervalMs: 0, deps });
  assert.equal(r.ok, true);
  assert.equal(r.incompleteForums, undefined);
  assert.equal(r.emptyForums, undefined);
});

test('signAccount:中途重取会话失败时,账号失败且已签结果保留', async () => {
  const { deps } = makeDeps(route({
    session: [sessionOk({ tbs: 'TBS1', forums: [forum(1, '甲'), forum(2, '乙')] }), sessionAuthFail()],
    sign: { 甲: { error_code: '0', error: { errno: 320022 } }, 乙: { error_code: '0', user_info: { sign_bonus_point: 1 } } },
  }));
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', intervalMs: 0, deps });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'auth');
  assert.deepEqual(r.results, [{ kw: '甲', level: 8, status: 'tbs-stale' }]);
});

test('countKeyFor:已知态映射到计数键,未知态归 failed 不写 NaN', () => {
  assert.equal(countKeyFor('tbs-stale'), 'tbsStale');
  assert.equal(countKeyFor('signed'), 'signed');
  assert.equal(countKeyFor('sixth-state'), 'failed');
  assert.equal(countKeyFor(undefined), 'failed');
});
