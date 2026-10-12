// Task 4:单账号签到主流程、失败路径与列表歧义标记。全部离线:fetchImpl 与 sleep 都是桩。
// 路由桩与常量在 ./account-helpers.js;tbs 重试见 ./account-retry.test.js;filter 见 ./account-filter.test.js。

import test from 'node:test';
import assert from 'node:assert/strict';

import { countKeyFor, signAccount } from '../src/account.js';
import { forum, makeDeps, json, route, signCalls, TBS, ZERO } from './account-helpers.js';

test('signAccount:逐吧状态与账号计数正确,间隔走注入 sleep', async () => {
  const sign = {
    甲: { error_code: '0', user_info: { sign_bonus_point: 12 } },
    乙: { error_code: '160002' },
    丙: { error_code: '340006' },
  };
  const { deps, calls, sleeps } = makeDeps(
    route({ guide: [{ like_forum: [forum(1, '甲'), forum(2, '乙'), forum(3, '丙')] }], sign }),
  );
  const r = await signAccount({ name: 'acc1', cookie: 'BDUSS=x', intervalMs: 0, deps });
  assert.equal(r.name, 'acc1');
  assert.equal(r.ok, true);
  assert.equal(r.error, null);
  assert.equal(r.reason, 'ok');
  assert.deepEqual(r.results, [
    { kw: '甲', status: 'signed' },
    { kw: '乙', status: 'already' },
    { kw: '丙', status: 'blocked' },
  ]);
  assert.deepEqual(r.counts, { signed: 1, already: 1, blocked: 1, tbsStale: 0, failed: 0 });
  assert.equal(signCalls(calls).length, 3);
  assert.deepEqual(sleeps, [0, 0]);
});

test('signAccount:凭据失效 -> ok:false 带 reason auth 与 error,不发后续请求', async () => {
  const { deps, calls } = makeDeps(route({ tbs: [{ is_login: 0 }] }));
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

test('signAccount:关注列表取不到 -> ok:false 带传输层原因', async () => {
  const { deps } = makeDeps((url) =>
    url === TBS ? json({ is_login: 1, tbs: 'T' }) : { status: 503, text: 'down' },
  );
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', deps });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'http');
  assert.ok(r.error);
});

test('signAccount:关注 0 个吧不当作全部已签,标 emptyForums', async () => {
  const { deps, calls } = makeDeps(route({ guide: [{ error_code: '0', like_forum: [] }] }));
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', deps });
  assert.equal(r.ok, true);
  assert.equal(r.emptyForums, true);
  assert.deepEqual(r.results, []);
  assert.equal(signCalls(calls).length, 0);
});

test('signAccount:关注列表未取完(hasMore)标 incompleteForums,仍签已拿到的吧', async () => {
  const { deps } = makeDeps(
    route({
      guide: [{ like_forum: [forum(1, '甲')], like_forum_has_more: '1' }],
      sign: { 甲: { error_code: '0', user_info: { sign_bonus_point: 1 } } },
    }),
  );
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', intervalMs: 0, deps });
  assert.equal(r.incompleteForums, true);
  assert.equal(r.counts.signed, 1);
});

test('signAccount:中途重取 tbs 失败也带出 incompleteForums(列表被截断)', async () => {
  const { deps } = makeDeps(
    route({
      tbs: [{ is_login: 1, tbs: 'TBS1' }, { is_login: 0 }],
      guide: [{ like_forum: [forum(1, '甲'), forum(2, '乙')], like_forum_has_more: '1' }],
      sign: {
        甲: { error_code: '0', user_info: { sign_bonus_point: 1 } },
        乙: { error_code: '0', error: { errno: 320022 } },
      },
    }),
  );
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', intervalMs: 0, deps });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'auth');
  assert.equal(r.incompleteForums, true);
  assert.deepEqual(r.results, [
    { kw: '甲', status: 'signed' },
    { kw: '乙', status: 'tbs-stale' },
  ]);
  assert.equal(r.counts.tbsStale, 1);
});

test('signAccount:某吧的 fetch 抛错不中断账号,记 failed 且后续吧照签', async () => {
  const { deps, calls } = makeDeps(
    route({
      guide: [{ like_forum: [forum(1, '甲'), forum(2, '乙')] }],
      sign: (kw) =>
        kw === '甲'
          ? { throw: new Error('socket hang up') }
          : { error_code: '0', user_info: { sign_bonus_point: 3 } },
    }),
  );
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', intervalMs: 0, deps });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results, [
    { kw: '甲', status: 'failed' },
    { kw: '乙', status: 'signed' },
  ]);
  assert.equal(r.counts.failed, 1);
  assert.equal(r.counts.signed, 1);
  assert.equal(signCalls(calls).length, 2);
});

test('countKeyFor:已知态映射到计数键,未知态归 failed 不写 NaN', () => {
  assert.equal(countKeyFor('tbs-stale'), 'tbsStale');
  assert.equal(countKeyFor('signed'), 'signed');
  assert.equal(countKeyFor('sixth-state'), 'failed');
  assert.equal(countKeyFor(undefined), 'failed');
});
