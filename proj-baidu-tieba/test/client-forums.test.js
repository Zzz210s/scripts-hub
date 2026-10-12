// Task 3:HTTP 客户端的关注列表部分(含分页)。全部离线:fetchImpl 是桩,无真实网络。
// 接口地址、表单参数、`like_forum_has_more` 分页口径的出处见 ../NOTICE。

import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchFollowedForums } from '../src/client.js';
import { jsonReply, stub } from './stub.js';

const pageOf = (options) => new URLSearchParams(options.body).get('page_no');

test('fetchFollowedForums:POST forumGuide,表单参数与头齐全,映射 is_sign/is_forbidden', async () => {
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
  assert.equal(result.reason, 'ok');
  assert.equal(result.hasMore, false);
  assert.equal(result.count, 2);
  assert.deepEqual(result.forums, [
    { fid: 1, kw: '吧一', isSign: true, isForbidden: false },
    { fid: 2, kw: '吧二', isSign: false, isForbidden: true },
  ]);
  assert.equal(calls[0].url, 'https://tieba.baidu.com/c/f/forum/forumGuide');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Subapp-Type'], 'hybrid');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(calls[0].options.headers.Referer, 'https://tieba.baidu.com/');
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('sort_type'), '3');
  assert.equal(body.get('call_from'), '3');
  assert.equal(body.get('page_no'), '1');
  assert.equal(body.get('res_num'), '200');
});

test('fetchFollowedForums:按 like_forum_has_more 翻页并汇总', async () => {
  const pages = {
    1: { like_forum: [{ forum_id: 1, forum_name: 'a', is_sign: 0 }], like_forum_has_more: '1' },
    2: { like_forum: [{ forum_id: 2, forum_name: 'b', is_sign: 1 }], like_forum_has_more: '0' },
  };
  const { calls, fetchImpl } = stub((url, options) => ({
    text: JSON.stringify(pages[pageOf(options)]),
  }));
  const result = await fetchFollowedForums({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.equal(result.hasMore, false);
  assert.deepEqual(result.forums.map((f) => f.fid), [1, 2]);
  assert.deepEqual(calls.map((c) => pageOf(c.options)), ['1', '2']);
  assert.equal(new URLSearchParams(calls[1].options.body).get('res_num'), '200');
});

test('fetchFollowedForums:达 10 页上限仍未取完时如实回报 hasMore=true', async () => {
  const { calls, fetchImpl } = stub((url, options) => ({
    text: JSON.stringify({
      like_forum: [{ forum_id: pageOf(options), forum_name: 'x', is_sign: 0 }],
      like_forum_has_more: '1',
    }),
  }));
  const result = await fetchFollowedForums({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 10);
  assert.equal(result.count, 10);
  assert.equal(result.hasMore, true);
});

test('fetchFollowedForums:缺 like_forum 数组且 error_code 非 0 判 auth', async () => {
  const { fetchImpl } = stub(jsonReply({ error_code: '1', error_msg: 'not login' }));
  const result = await fetchFollowedForums({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.forums, null);
  assert.equal(result.reason, 'auth');
  assert.equal(result.error, 'not login');
});

test('fetchFollowedForums:空列表 + error_code 非 0 不当成功(不能只看有没有数组)', async () => {
  const { fetchImpl } = stub(jsonReply({ error_code: 340006, like_forum: [] }));
  const result = await fetchFollowedForums({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.forums, null);
  assert.equal(result.reason, 'auth');
  assert.ok(result.error);
});

test('fetchFollowedForums:空列表且 error_code 为 0 是合法结果(ok + 空数组)', async () => {
  const { fetchImpl } = stub(jsonReply({ error_code: '0', like_forum: [] }));
  const result = await fetchFollowedForums({ cookie: 'BDUSS=x', deps: { fetchImpl } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.forums, []);
  assert.equal(result.count, 0);
});

test('fetchFollowedForums:HTTP 500 判 http,响应非 JSON 判 parse', async () => {
  const failed = await fetchFollowedForums({
    cookie: 'BDUSS=x',
    deps: { fetchImpl: stub(() => ({ status: 503, text: 'down' })).fetchImpl },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'http');
  assert.equal(failed.hasMore, false);

  const bad = await fetchFollowedForums({
    cookie: 'BDUSS=x',
    deps: { fetchImpl: stub(() => ({ text: '<html>' })).fetchImpl },
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'parse');
});
