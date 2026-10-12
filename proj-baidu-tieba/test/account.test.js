// Task 4:单账号签到流程。全部离线:fetchImpl 与 sleep 都是桩,无真实网络、无真实等待。
// 两个请求地址与形状来自 ../src/client.js;重试口径见 ../src/account.js 顶部注释。

import test from 'node:test';
import assert from 'node:assert/strict';

import { signAccount } from '../src/account.js';
import { stub } from './stub.js';

const TBS = 'https://tieba.baidu.com/dc/common/tbs';
const GUIDE = 'https://tieba.baidu.com/c/f/forum/forumGuide';
const SIGN = 'https://c.tieba.baidu.com/c/c/forum/sign';
const json = (payload) => ({ text: JSON.stringify(payload) });
const signCalls = (calls) => calls.filter((call) => call.url === SIGN);
const forum = (id, kw, extra = {}) => ({ forum_id: id, forum_name: kw, is_sign: 0, ...extra });
const ZERO = { signed: 0, already: 0, blocked: 0, tbsStale: 0, failed: 0 };

/** 记录 sleep 的 deps;`route` 按 url 分派响应。 */
function makeDeps(route) {
  const sleeps = [];
  const { calls, fetchImpl } = stub(route);
  const sleep = async (ms) => {
    sleeps.push(ms);
  };
  return { deps: { fetchImpl, sleep }, calls, sleeps };
}

/** 按 url 分派: tbs/guide 按序取数组末项兜底,sign 按 kw 取对象或函数。 */
function route({ tbs = [{ is_login: 1, tbs: 'TBS1' }], guide = [{ like_forum: [] }], sign = {} }) {
  let tbsAt = 0;
  let guideAt = 0;
  return (url, options) => {
    if (url === TBS) return json(tbs[Math.min(tbsAt++, tbs.length - 1)]);
    if (url === GUIDE) return json(guide[Math.min(guideAt++, guide.length - 1)]);
    const body = new URLSearchParams(options.body);
    const reply = typeof sign === 'function' ? sign(body.get('kw'), body) : sign[body.get('kw')];
    return json(reply ?? { error_code: '1', error_msg: 'unexpected' });
  };
}

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

test('signAccount:filter 谓词只签命中的吧;数组形态按吧名白名单', async () => {
  const guide = [{ like_forum: [forum(1, '甲'), forum(2, '乙')] }];
  const sign = {
    甲: { error_code: '0', user_info: { sign_bonus_point: 1 } },
    乙: { error_code: '0', user_info: { sign_bonus_point: 1 } },
  };
  const byFn = makeDeps(route({ guide, sign }));
  const first = await signAccount({
    name: 'a',
    cookie: 'BDUSS=x',
    intervalMs: 0,
    deps: byFn.deps,
    filter: (f) => f.kw === '乙',
  });
  assert.deepEqual(first.results, [{ kw: '乙', status: 'signed' }]);
  assert.equal(signCalls(byFn.calls).length, 1);
  const byList = makeDeps(route({ guide, sign }));
  const second = await signAccount({
    name: 'a',
    cookie: 'BDUSS=x',
    intervalMs: 0,
    deps: byList.deps,
    filter: ['甲'],
  });
  assert.deepEqual(second.results, [{ kw: '甲', status: 'signed' }]);
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
