// Task 3:HTTP 客户端的测试。全部离线:fetchImpl 是桩,没有任何真实网络请求。
// 接口地址、表单参数与返回码的出处见 ../../NOTICE。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fetchFollowedForums, fetchTbs, signForum } from '../src/client.js';
import { SIGN_STATUS } from '../src/sign.js';

const loadText = (name) =>
  readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

/** 记录调用的 fetchImpl 桩;`reply` 返回 { status, text } 或 { throw: Error }。 */
function stub(reply) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const result = reply(url, options);
    if (result.throw) throw result.throw;
    return {
      ok: result.status === undefined || result.status < 400,
      status: result.status ?? 200,
      text: async () => result.text,
    };
  };
  return { calls, fetchImpl };
}

const jsonReply = (payload) => () => ({ text: JSON.stringify(payload) });

test('fetchTbs:GET /dc/common/tbs,带 cookie 与 UA,成功返回 tbs', async () => {
  const { calls, fetchImpl } = stub(jsonReply({ is_login: 1, tbs: 'TBS_SAMPLE' }));
  const result = await fetchTbs({ cookie: 'BDUSS=BDUSS_SAMPLE; STOKEN=x', deps: { fetchImpl } });
  assert.deepEqual(result, { ok: true, tbs: 'TBS_SAMPLE', error: null });
  assert.equal(calls[0].url, 'https://tieba.baidu.com/dc/common/tbs');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Cookie, 'BDUSS=BDUSS_SAMPLE; STOKEN=x');
  assert.ok(calls[0].options.headers['User-Agent']);
  assert.ok(calls[0].options.signal);
});

test('fetchTbs:is_login 为假判失败,不把空 tbs 当成功', async () => {
  const { fetchImpl } = stub(jsonReply({ is_login: 0, tbs: '' }));
  const result = await fetchTbs({ cookie: 'BDUSS=', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.tbs, null);
  assert.match(result.error, /登录/);
});

test('fetchTbs:HTTP 500 归一为 ok:false,不抛', async () => {
  const { fetchImpl } = stub(() => ({ status: 500, text: '<html>boom</html>' }));
  const result = await fetchTbs({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.tbs, null);
  assert.match(result.error, /500/);
});

test('fetchTbs:响应不是 JSON 归一为 ok:false', async () => {
  const { fetchImpl } = stub(() => ({ text: '<html>login</html>' }));
  const result = await fetchTbs({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.match(result.error, /JSON/);
});

test('fetchTbs:fetchImpl 抛错(网络失败)也归一为 ok:false', async () => {
  const { fetchImpl } = stub(() => ({ throw: new Error('ECONNRESET') }));
  const result = await fetchTbs({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNRESET/);
});

test('fetchTbs:超时经 AbortController 打断,归一为 ok:false', async () => {
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
  assert.match(result.error, /超时/);
  assert.ok(seen.signal.aborted);
});

test('fetchFollowedForums:POST forumGuide,表单参数与 Subapp-Type 齐全', async () => {
  const payload = {
    like_forum: [
      { forum_id: 1, forum_name: '吧一', is_sign: 1, is_forbidden: 0 },
      { forum_id: 2, forum_name: '吧二', is_sign: '0', is_forbidden: 1 },
    ],
  };
  const { calls, fetchImpl } = stub(jsonReply(payload));
  const result = await fetchFollowedForums({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.deepEqual(result.forums, [
    { fid: 1, kw: '吧一', isSign: true, isForbidden: false },
    { fid: 2, kw: '吧二', isSign: false, isForbidden: true },
  ]);
  assert.equal(calls[0].url, 'https://tieba.baidu.com/c/f/forum/forumGuide');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Subapp-Type'], 'hybrid');
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('sort_type'), '3');
  assert.equal(body.get('call_from'), '3');
  assert.equal(body.get('page_no'), '1');
  assert.equal(body.get('res_num'), '200');
});

test('fetchFollowedForums:响应里没有 like_forum 数组判失败', async () => {
  const { fetchImpl } = stub(jsonReply({ error_code: '1', error_msg: 'nope' }));
  const result = await fetchFollowedForums({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.forums, null);
  assert.ok(result.error);
});

test('signForum:POST /c/c/forum/sign,参数齐全且含大写签名', async () => {
  const { calls, fetchImpl } = stub(() => ({ text: loadText('sign-ok.json') }));
  const status = await signForum({
    cookie: 'BDUSS=BDUSS_SAMPLE; STOKEN=x',
    forum: { fid: 12345, kw: '测试吧' },
    tbs: 'TBS_SAMPLE',
    deps: { fetchImpl },
  });
  assert.equal(status, SIGN_STATUS.SIGNED);
  assert.equal(calls[0].url, 'https://c.tieba.baidu.com/c/c/forum/sign');
  assert.equal(calls[0].options.method, 'POST');
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

test('signForum:嵌套 320022 判为 tbs-stale(回归)', async () => {
  const { fetchImpl } = stub(() => ({ text: loadText('sign-tbs-stale.json') }));
  const status = await signForum({
    cookie: 'BDUSS=BDUSS_SAMPLE',
    forum: { fid: 1, kw: 'a' },
    tbs: 'TBS_SAMPLE',
    deps: { fetchImpl },
  });
  assert.equal(status, SIGN_STATUS.TBS_STALE);
});

test('signForum:HTTP 500 归为 failed,不抛', async () => {
  const { fetchImpl } = stub(() => ({ status: 500, text: 'boom' }));
  const status = await signForum({
    cookie: 'BDUSS=BDUSS_SAMPLE',
    forum: { fid: 1, kw: 'a' },
    tbs: 'TBS_SAMPLE',
    deps: { fetchImpl },
  });
  assert.equal(status, SIGN_STATUS.FAILED);
});

test('signForum:cookie 里没有 BDUSS 直接判 failed 且不发请求', async () => {
  let called = false;
  const { fetchImpl } = stub(() => {
    called = true;
    return { text: '{}' };
  });
  const status = await signForum({
    cookie: 'STOKEN=x',
    forum: { fid: 1, kw: 'a' },
    tbs: 'TBS_SAMPLE',
    deps: { fetchImpl },
  });
  assert.equal(status, SIGN_STATUS.FAILED);
  assert.equal(called, false);
});
