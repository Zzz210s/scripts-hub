// 互动接口层的回归:签名、三个接口的归一、以及「已经点过赞」这种幂等返回。
//
// 协议形状全部来自 2026-10-30 的真机响应,夹具照抄返回体,不自己编。

import assert from 'node:assert/strict';
import test from 'node:test';

import { clientSign } from '../src/client-sign.js';
import { fetchThreads, likeThread, postReply } from '../src/interact-api.js';

const COOKIE = 'BDUSS=BDUSS_SAMPLE';

function stub(reply) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return reply(url, options);
  };
  return { calls, fetchImpl };
}

const jsonReply = (body) => async () => ({
  status: 200,
  ok: true,
  text: async () => JSON.stringify(body),
  headers: { get: () => 'application/json' }
});

test('签名:按键名排序拼参数 + 固定盐,结果大写 32 位;sign 自身不参与', () => {
  const sign = clientSign({ b: '2', a: '1' });
  assert.equal(sign, clientSign({ a: '1', b: '2', sign: 'IGNORED' }));
  assert.match(sign, /^[0-9A-F]{32}$/);
  assert.notEqual(sign, clientSign({ a: '1', b: '3' }));
});

test('拉帖子列表:带签名与客户端 UA,解析出 tid 数组', async () => {
  const { calls, fetchImpl } = stub(jsonReply({ error_code: 0, thread_list: [{ id: 11149801059 }, { tid: '22222222' }, { id: 'x' }] }));
  const result = await fetchThreads({ kw: '2ch', limit: 3, cookie: COOKIE, deps: { fetchImpl } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.tids, ['11149801059', '22222222']);
  assert.match(calls[0].url, /c\.tieba\.baidu\.com\/c\/f\/frs\/page\?/);
  assert.match(calls[0].url, /sign=[0-9A-F]{32}/);
  assert.match(calls[0].options.headers['User-Agent'], /bdtb/);
});

test('拉帖子列表:没有 thread_list 判 parse,不抛', async () => {
  const { fetchImpl } = stub(jsonReply({ error_code: 110001 }));
  const result = await fetchThreads({ kw: 'x', cookie: COOKIE, deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'parse');
});

test('回帖:no=0 判成功,失败把服务端原话带回来;experience 不作为经验增量', async () => {
  const okReply = stub(jsonReply({ no: 0, err_code: 0, error: null, data: { pid: 987, experience: 0 } }));
  const ok = await postReply({ kw: '2ch', fid: 839326, tid: '111', content: '+3', tbs: 'T', cookie: COOKIE, deps: { fetchImpl: okReply.fetchImpl } });
  assert.equal(ok.ok, true);
  assert.equal(ok.pid, 987);
  assert.equal(ok.risk, null);
  const body = okReply.calls[0].options.body;
  assert.match(body, /content=%2B3/);
  assert.match(body, /tbs=T/);
  assert.equal(okReply.calls[0].options.method, 'POST');

  const bad = await postReply({ kw: 'x', fid: 1, tid: '1', content: '+3', tbs: 'T', cookie: COOKIE, deps: { fetchImpl: stub(jsonReply({ no: 4, error: '帖子已被删除' })).fetchImpl } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, '帖子已被删除');
});

test('回帖:响应里 need_vcode=1 是风控信号,要能叫停整轮', async () => {
  const { fetchImpl } = stub(jsonReply({ no: 0, data: { vcode: { need_vcode: 1, str_reason: '系统繁忙' } } }));
  const result = await postReply({ kw: 'x', fid: 1, tid: '1', content: '+3', tbs: 'T', cookie: COOKIE, deps: { fetchImpl } });
  assert.equal(result.ok, true);
  assert.equal(result.risk, '需要验证码');
});

test('点赞:error_code 0 是成功,3280001 是「已经点过赞」也算成功', async () => {
  const first = await likeThread({ tid: '111', tbs: 'T', cookie: COOKIE, deps: { fetchImpl: stub(jsonReply({ error_code: '0' })).fetchImpl } });
  assert.deepEqual([first.ok, first.already], [true, false]);

  const again = await likeThread({ tid: '111', tbs: 'T', cookie: COOKIE, deps: { fetchImpl: stub(jsonReply({ error_code: '3280001', error_msg: '您已经点过赞了' })).fetchImpl } });
  assert.deepEqual([again.ok, again.already], [true, true]);
});

test('点赞:其它错误码判失败,并把服务端文案带回来', async () => {
  const { fetchImpl } = stub(jsonReply({ error_code: '300000', error_msg: '未知错误' }));
  const result = await likeThread({ tid: '111', tbs: 'T', cookie: COOKIE, deps: { fetchImpl } });
  assert.equal(result.ok, false);
  assert.equal(result.error, '未知错误');
  assert.equal(result.risk, null);
});

test('点赞请求带 obj_type=3 与 agree_type=1 —— 换个组合服务端就回 300000', async () => {
  const { calls, fetchImpl } = stub(jsonReply({ error_code: '0' }));
  await likeThread({ tid: '111', tbs: 'T', cookie: COOKIE, deps: { fetchImpl } });
  const body = calls[0].options.body;
  assert.match(body, /obj_type=3/);
  assert.match(body, /agree_type=1/);
  assert.match(body, /thread_id=111/);
  assert.match(body, /sign=[0-9A-F]{32}/);
});
