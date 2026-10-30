// 关注列表(fetchFollowedForums)用 2026-10-14 真机校正后的协议:`GET /mo/q/newmoindex`
// 一次返回 uid、客户端 tbs 与 like_forum[](含 is_sign)。全部离线:fetchImpl 是桩。
import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchFollowedForums, fetchSession } from '../src/client.js';
import { jsonReply, stub } from './stub.js';

const SESSION_URL = 'https://tieba.baidu.com/mo/q/newmoindex';
const session = ({ forums = [], tbs = 'ITB_TBS_SAMPLE', uid = '1000000000', no = 0, error = 'success' } = {}) => ({
  no,
  error,
  data: no === 0 ? { uid, tbs: tbs.slice(-16), itb_tbs: tbs, like_forum: forums } : undefined,
});

test('fetchFollowedForums:映射 is_sign/is_forbidden,并带上 count 与 hasMore', async () => {
  const { calls, fetchImpl } = stub(jsonReply(session({
    forums: [
      { forum_id: 11, forum_name: '吧一', is_sign: 1, user_level: '8', user_exp: '832' },
      { forum_id: 12, forum_name: '吧二', is_sign: 0, is_forbidden: 1, user_level: '12' },
      { forum_id: 13, forum_name: '吧三' },
    ],
  })));
  const result = await fetchFollowedForums({ cookie: 'BDUSS=BDUSS_SAMPLE', deps: { fetchImpl } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
  assert.equal(result.hasMore, false); // 单次全量返回,不存在翻页
  assert.deepEqual(result.forums, [
    { fid: 11, kw: '吧一', level: 8, exp: 832, isSign: true, isForbidden: false },
    // 没有 user_exp 时是 null 而不是 0 —— 0 会被互动层读成「离升级还差满档」或「已满级」
    { fid: 12, kw: '吧二', level: 12, exp: null, isSign: false, isForbidden: true },
    { fid: 13, kw: '吧三', level: null, exp: null, isSign: false, isForbidden: false },
  ]);
  assert.equal(calls[0].url, SESSION_URL);
  assert.equal(calls[0].options.method, 'GET');
});

test('fetchFollowedForums:合法地关注 0 个吧是 ok + 空数组,由下游处理歧义', async () => {
  const { fetchImpl } = stub(jsonReply(session({ forums: [] })));
  const result = await fetchFollowedForums({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 0);
  assert.deepEqual(result.forums, []);
});

test('fetchFollowedForums:非 0 no + 非登录文案判 rejected(不能只看有没有数组)', async () => {
  const { fetchImpl } = stub(jsonReply({ no: 340006, error: '账号异常' }));
  const result = await fetchFollowedForums({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.forums, null);
  assert.equal(result.reason, 'rejected');
});

test('fetchFollowedForums:未登录判 auth,不能被空数组绕过', async () => {
  const { fetchImpl } = stub(jsonReply({ no: 1, error: '未登录' }));
  const result = await fetchFollowedForums({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'auth');
});

test('fetchFollowedForums:HTTP 500 判 http,响应非 JSON 判 parse', async () => {
  const down = stub(() => ({ status: 500, text: 'boom' }));
  assert.equal((await fetchFollowedForums({ cookie: 'BDUSS=x', deps: { fetchImpl: down.fetchImpl } })).reason, 'http');
  const html = stub(() => ({ text: '<html>login</html>' }));
  assert.equal((await fetchFollowedForums({ cookie: 'BDUSS=x', deps: { fetchImpl: html.fetchImpl } })).reason, 'parse');
});

test('fetchFollowedForums:cookie 里没有 BDUSS 判 no-cookie 且不发请求', async () => {
  const { calls, fetchImpl } = stub(jsonReply(session()));
  const result = await fetchFollowedForums({ cookie: 'STOKEN=x', deps: { fetchImpl } });
  assert.equal(result.reason, 'no-cookie');
  assert.equal(calls.length, 0);
});

// 2026-10-14 真机抓到的夹具:同一份 cookie 下 `/dc/common/tbs` 会回 is_login:0,而这里的
// like_forum 与 tbs 都正常 —— 会话判定绝不能再依赖那个标志位(见 NOTICE)。
test('真机夹具:newmoindex 的返回能解析出 tbs/uid/关注列表', async () => {
  const fixture = JSON.parse(await (await import('node:fs/promises')).readFile(
    new URL('./fixtures/real/newmoindex-ok.json', import.meta.url), 'utf8',
  ));
  const { fetchImpl } = stub(jsonReply(fixture));
  const result = await fetchSession({ cookie: 'BDUSS=BDUSS_SAMPLE', deps: { fetchImpl } });
  assert.equal(result.ok, true);
  assert.equal(result.tbs, fixture.data.itb_tbs);
  assert.equal(result.uid, '1000000000'); // 夹具里 uid 已打码
  assert.equal(result.forums.length, fixture.data.like_forum.length);
  assert.equal(result.forums[0].kw, fixture.data.like_forum[0].forum_name);
  assert.equal(result.forums[0].isSign, String(fixture.data.like_forum[0].is_sign) === '1');
});
