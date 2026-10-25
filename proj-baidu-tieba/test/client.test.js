// Task 3:HTTP 客户端的 tbs 与签到部分。全部离线:fetchImpl 是桩,没有任何真实网络请求。
// 接口地址、表单参数与返回码的出处见 ../NOTICE。

import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchSession, fetchTbs, signForum } from '../src/client.js';
import { SIGN_STATUS } from '../src/sign.js';
import { jsonReply, loadText, stub } from './stub.js';

const SESSION_URL = 'https://tieba.baidu.com/mo/q/newmoindex';
/** newmoindex 的成功形状(真机实测:uid + itb_tbs + like_forum)。 */
const session = ({ tbs = 'TBS_SAMPLE', uid = '1000000000', forums = [] } = {}) => ({ no: 0, error: 'success', data: { uid, tbs: tbs.slice(-16), itb_tbs: tbs, like_forum: forums } });

test('fetchSession:GET /mo/q/newmoindex,带 cookie/UA/Referer,tbs 取 itb_tbs', async () => {
  const body = session({ tbs: 'ITB_TBS_SAMPLE', forums: [{ forum_id: 11, forum_name: '吧一', is_sign: 1, user_level: '8' }] });
  const { calls, fetchImpl } = stub(jsonReply(body));
  const result = await fetchSession({ cookie: 'BDUSS=BDUSS_SAMPLE; STOKEN=x', deps: { fetchImpl } });
  assert.equal(result.ok, true);
  assert.equal(result.tbs, 'ITB_TBS_SAMPLE');
  assert.equal(result.uid, '1000000000');
  assert.deepEqual(result.forums, [{ fid: 11, kw: '吧一', level: 8, isSign: true, isForbidden: false }]);
  assert.equal(result.count, 1);
  assert.equal(calls[0].url, SESSION_URL);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Cookie, 'BDUSS=BDUSS_SAMPLE; STOKEN=x');
  assert.equal(calls[0].options.headers.Referer, 'https://tieba.baidu.com/');
  assert.ok(calls[0].options.headers['User-Agent']);
  assert.ok(calls[0].options.signal);
});

test('fetchSession:未登录的文案归 auth,不把空 tbs 当成功', async () => {
  const { fetchImpl } = stub(jsonReply({ no: 1, error: '未登录' }));
  const result = await fetchSession({ cookie: 'BDUSS=SOMEVALUE', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'auth');
  assert.match(result.error, /登录/);
});

test('fetchSession:非 0 no 但不是登录问题归 rejected', async () => {
  const { fetchImpl } = stub(jsonReply({ no: 340006, error: '账号异常' }));
  const result = await fetchSession({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rejected');
});

test('fetchSession:no=0 但缺 data 判 parse', async () => {
  const { fetchImpl } = stub(jsonReply({ no: 0, error: 'success' }));
  const result = await fetchSession({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'parse');
});

test('fetchSession:缺 BDUSS 时不发请求(reason=no-cookie)', async () => {
  const { calls, fetchImpl } = stub(jsonReply(session()));
  const result = await fetchSession({ cookie: 'STOKEN=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-cookie');
  assert.equal(calls.length, 0);
});

test('fetchSession:HTTP 500 归一为 ok:false/reason=http,不抛', async () => {
  const { fetchImpl } = stub(() => ({ status: 500, text: '<html>boom</html>' }));
  const result = await fetchSession({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'http');
  assert.match(result.error, /500/);
});

test('fetchSession:响应不是 JSON 归一为 ok:false/reason=parse', async () => {
  const { fetchImpl } = stub(() => ({ text: '<html>login</html>' }));
  const result = await fetchSession({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'parse');
  assert.match(result.error, /JSON/);
});

test('fetchSession:fetchImpl 抛错(网络失败)归一为 ok:false/reason=network', async () => {
  const { fetchImpl } = stub(() => ({ throw: new Error('ECONNRESET') }));
  const result = await fetchSession({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'network');
  assert.match(result.error, /ECONNRESET/);
});

test('fetchTbs 是 fetchSession 的薄视图:成功时只回 tbs', async () => {
  const { fetchImpl } = stub(jsonReply(session({ tbs: 'TBS_ONLY' })));
  const result = await fetchTbs({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.deepEqual(result, { ok: true, tbs: 'TBS_ONLY', error: null, reason: 'ok' });
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
