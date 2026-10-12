// Task 4:tbs-stale 的重取口径(全文只重取一次)。全部离线,桩与常量见 ./account-helpers.js。

import test from 'node:test';
import assert from 'node:assert/strict';

import { signAccount } from '../src/account.js';
import { forum, makeDeps, route, signCalls, TBS } from './account-helpers.js';

test('signAccount:tbs-stale 时重取一次 tbs,并用新 tbs 重试那一个吧', async () => {
  let signAt = 0;
  const { deps, calls } = makeDeps(
    route({
      tbs: [{ is_login: 1, tbs: 'TBS1' }, { is_login: 1, tbs: 'TBS2' }],
      guide: [{ like_forum: [forum(1, '甲')] }],
      sign: () => {
        signAt += 1;
        return signAt === 1
          ? { error_code: '0', error: { errno: 320022 } }
          : { error_code: '0', user_info: { sign_bonus_point: 5 } };
      },
    }),
  );
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', intervalMs: 0, deps });
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { signed: 1, already: 0, blocked: 0, tbsStale: 0, failed: 0 });
  assert.equal(calls.filter((call) => call.url === TBS).length, 2);
  const signs = signCalls(calls);
  assert.equal(new URLSearchParams(signs[0].options.body).get('tbs'), 'TBS1');
  assert.equal(new URLSearchParams(signs[1].options.body).get('tbs'), 'TBS2');
});

test('signAccount:全文只重取一次 tbs,后续 tbs-stale 不再重取;间隔默认 2000', async () => {
  let signAt = 0;
  const { deps, calls, sleeps } = makeDeps(
    route({
      tbs: [{ is_login: 1, tbs: 'TBS1' }, { is_login: 1, tbs: 'TBS2' }],
      guide: [{ like_forum: [forum(1, '甲'), forum(2, '乙')] }],
      sign: () => {
        signAt += 1;
        if (signAt === 2) return { error_code: '0', user_info: { sign_bonus_point: 5 } };
        return { error_code: '0', error: { errno: 320022 } };
      },
    }),
  );
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', deps });
  assert.equal(calls.filter((call) => call.url === TBS).length, 2);
  assert.deepEqual(r.counts, { signed: 1, already: 0, blocked: 0, tbsStale: 1, failed: 0 });
  assert.deepEqual(sleeps, [2000]);
});

test('signAccount:重取 tbs 失败时账号失败,该吧如实记为 tbs-stale', async () => {
  const { deps } = makeDeps(
    route({
      tbs: [{ is_login: 1, tbs: 'TBS1' }, { is_login: 0 }],
      guide: [{ like_forum: [forum(1, '甲')] }],
      sign: { 甲: { error_code: '0', error: { errno: 320022 } } },
    }),
  );
  const r = await signAccount({ name: 'a', cookie: 'BDUSS=x', intervalMs: 0, deps });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'auth');
  assert.deepEqual(r.results, [{ kw: '甲', status: 'tbs-stale' }]);
  assert.equal(r.counts.tbsStale, 1);
});
