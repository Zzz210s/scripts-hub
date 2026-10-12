// Task 3:HTTP 客户端的 tbs 与签到部分。全部离线:fetchImpl 是桩,没有任何真实网络请求。
// 接口地址、表单参数与返回码的出处见 ../NOTICE。

import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchTbs, signForum } from '../src/client.js';
import { SIGN_STATUS } from '../src/sign.js';
import { jsonReply, loadText, stub } from './stub.js';

test('fetchTbs:GET /dc/common/tbs,带 cookie/UA/Referer,成功返回 tbs', async () => {
  const { calls, fetchImpl } = stub(jsonReply({ is_login: 1, tbs: 'TBS_SAMPLE' }));
  const result = await fetchTbs({ cookie: 'BDUSS=BDUSS_SAMPLE; STOKEN=x', deps: { fetchImpl } });
  assert.deepEqual(result, { ok: true, tbs: 'TBS_SAMPLE', error: null, reason: 'ok' });
  assert.equal(calls[0].url, 'https://tieba.baidu.com/dc/common/tbs');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Cookie, 'BDUSS=BDUSS_SAMPLE; STOKEN=x');
  assert.equal(calls[0].options.headers.Referer, 'https://tieba.baidu.com/');
  assert.ok(calls[0].options.headers['User-Agent']);
  assert.ok(calls[0].options.signal);
});

test('fetchTbs:is_login 为假判失败且 reason=auth,不把空 tbs 当成功', async () => {
  const { fetchImpl } = stub(jsonReply({ is_login: 0, tbs: '' }));
  const result = await fetchTbs({ cookie: 'BDUSS=SOMEVALUE', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.tbs, null);
  assert.equal(result.reason, 'auth');
  assert.match(result.error, /登录/);
});

test('fetchTbs:HTTP 500 归一为 ok:false/reason=http,不抛', async () => {
  const { fetchImpl } = stub(() => ({ status: 500, text: '<html>boom</html>' }));
  const result = await fetchTbs({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.tbs, null);
  assert.equal(result.reason, 'http');
  assert.match(result.error, /500/);
});

test('fetchTbs:响应不是 JSON 归一为 ok:false/reason=parse', async () => {
  const { fetchImpl } = stub(() => ({ text: '<html>login</html>' }));
  const result = await fetchTbs({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'parse');
  assert.match(result.error, /JSON/);
});

test('fetchTbs:JSON 里没有 tbs 也算 parse,不当成功', async () => {
  const { fetchImpl } = stub(jsonReply({ is_login: 1 }));
  const result = await fetchTbs({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.tbs, null);
  assert.equal(result.reason, 'parse');
});

test('fetchTbs:fetchImpl 抛错(网络失败)归一为 ok:false/reason=network', async () => {
  const { fetchImpl } = stub(() => ({ throw: new Error('ECONNRESET') }));
  const result = await fetchTbs({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'network');
  assert.match(result.error, /ECONNRESET/);
});

test('fetchTbs:超时经 AbortController 打断,归一为 ok:false/reason=network', async () => {
  let seen = null;
  const fetchImpl = (url, options) =>
    new Promise((resolve, reject) => {
      seen = options;
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  const result = await fetchTbs({ cookie: 'BDUSS=x', deps: { fetchImpl, timeoutMs: 10 } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'network');
  assert.match(result.error, /超时/);
  assert.ok(seen.signal.aborted);
});

test('fetchTbs:cookie 为空或缺 BDUSS 时判 no-cookie 且不发匿名请求', async () => {
  let called = false;
  const { fetchImpl } = stub(() => {
    called = true;
    return { text: '{"is_login":1,"tbs":"T"}' };
  });
  const empty = await fetchTbs({ deps: { fetchImpl } });
  const noBduss = await fetchTbs({ cookie: 'STOKEN=x', deps: { fetchImpl } });
  assert.equal(empty.ok, false);
  assert.equal(empty.tbs, null);
  assert.equal(empty.reason, 'no-cookie');
  assert.equal(noBduss.ok, false);
  assert.equal(noBduss.reason, 'no-cookie');
  assert.equal(called, false);
});

test('fetchTbs:deps 为 null 不抛(默认 globalThis.fetch)', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '{"is_login":1,"tbs":"T"}',
  });
  try {
    const result = await fetchTbs({ cookie: 'BDUSS=x', deps: null });
    assert.equal(result.ok, true);
    assert.equal(result.tbs, 'T');
  } finally {
    globalThis.fetch = original;
  }
});

test('signForum:POST /c/c/forum/sign,参数/头齐全且含大写签名', async () => {
  const { calls, fetchImpl } = stub(() => ({ text: loadText('sign-ok.json') }));
  const result = await signForum({
    cookie: 'BDUSS=BDUSS_SAMPLE; STOKEN=x',
    forum: { fid: 12345, kw: '测试吧' },
    tbs: 'TBS_SAMPLE',
    deps: { fetchImpl },
  });
  assert.deepEqual(result, { status: SIGN_STATUS.SIGNED, error: null, reason: 'ok' });
  assert.equal(calls[0].url, 'https://c.tieba.baidu.com/c/c/forum/sign');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Cookie, 'BDUSS=BDUSS_SAMPLE; STOKEN=x');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.ok(calls[0].options.headers['User-Agent']);
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('BDUSS'), 'BDUSS_SAMPLE');
  assert.equal(body.get('fid'), '12345');
  assert.equal(body.get('kw'), '测试吧');
  assert.equal(body.get('tbs'), 'TBS_SAMPLE');
  assert.equal(body.get('_client_type'), '2');
  assert.match(body.get('timestamp'), /^\d{10}$/);
  assert.match(body.get('sign'), /^[0-9A-F]{32}$/);
});

test('signForum:嵌套 320022 判为 tbs-stale(reason 仍是 ok,带原文文案)', async () => {
  const { fetchImpl } = stub(() => ({ text: loadText('sign-tbs-stale.json') }));
  const result = await signForum({
    cookie: 'BDUSS=BDUSS_SAMPLE',
    forum: { fid: 1, kw: 'a' },
    tbs: 'TBS_SAMPLE',
    deps: { fetchImpl },
  });
  assert.equal(result.status, SIGN_STATUS.TBS_STALE);
  assert.equal(result.reason, 'ok');
  assert.match(result.error, /TBS校验失败/);
});

test('signForum:HTTP 200 但响应不可判定时 reason=parse(不再一律 ok)', async () => {
  const { fetchImpl } = stub(() => ({ text: '{}' }));
  const result = await signForum({
    cookie: 'BDUSS=BDUSS_SAMPLE',
    forum: { fid: 1, kw: 'a' },
    tbs: 'TBS_SAMPLE',
    deps: { fetchImpl },
  });
  assert.equal(result.status, SIGN_STATUS.FAILED);
  assert.equal(result.reason, 'parse');
});

test('signForum:HTTP 500 归为 failed/reason=http,不抛', async () => {
  const { fetchImpl } = stub(() => ({ status: 500, text: 'boom' }));
  const result = await signForum({
    cookie: 'BDUSS=BDUSS_SAMPLE',
    forum: { fid: 1, kw: 'a' },
    tbs: 'TBS_SAMPLE',
    deps: { fetchImpl },
  });
  assert.equal(result.status, SIGN_STATUS.FAILED);
  assert.equal(result.reason, 'http');
  assert.match(result.error, /500/);
});

test('signForum:cookie 里没有 BDUSS 直接判 no-cookie 且不发请求', async () => {
  let called = false;
  const { fetchImpl } = stub(() => {
    called = true;
    return { text: '{}' };
  });
  const result = await signForum({
    cookie: 'STOKEN=x',
    forum: { fid: 1, kw: 'a' },
    tbs: 'TBS_SAMPLE',
    deps: { fetchImpl },
  });
  assert.equal(result.status, SIGN_STATUS.FAILED);
  assert.equal(result.reason, 'no-cookie');
  assert.ok(result.error);
  assert.equal(called, false);
});
