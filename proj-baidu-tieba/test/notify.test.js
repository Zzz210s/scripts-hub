// Task 10 企微通知传输层:成功、限流重试、硬失败不重试、超时、字节截断、key 掩码、缺 webhook。
// 全离线:fetchImpl 一律注入桩,不发真请求。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadWebhook, maskSecret, sendWecom, truncateText } from '../src/notify.js';
import { stub } from './stub.js';

const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd1234-efgh-5678';
const KEY = 'abcd1234-efgh-5678';
const OK = { text: JSON.stringify({ errcode: 0, errmsg: 'ok' }) };
const errReply = (errcode, errmsg) => ({ text: JSON.stringify({ errcode, errmsg }) });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-notify-'));
const noSleep = async () => {};
const bodyOf = (call) => JSON.parse(call.options.body);

test('成功:POST text 消息体到 webhook,返回 ok', async () => {
  const { calls, fetchImpl } = stub(() => OK);
  const res = await sendWecom('贴吧签到完成', { webhook: WEBHOOK, fetchImpl });
  assert.deepEqual(res, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, WEBHOOK);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(bodyOf(calls[0]), { msgtype: 'text', text: { content: '贴吧签到完成' } });
});

test('dryRun 只回执不发送', async () => {
  const { calls, fetchImpl } = stub(() => OK);
  const res = await sendWecom('预览', { webhook: WEBHOOK, fetchImpl, dryRun: true });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 0);
});

test('45009 限流:退避重试一次后成功,并回调 onRetry', async () => {
  let n = 0;
  const { calls, fetchImpl } = stub(() => (++n === 1 ? errReply(45009, 'api freq out of limit') : OK));
  const attempts = [];
  const sleeps = [];
  const res = await sendWecom('hi', {
    webhook: WEBHOOK,
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms); },
    onRetry: (_error, attempt) => attempts.push(attempt),
  });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(attempts, [1]);
  assert.deepEqual(sleeps, [1000]);
});

for (const code of [93000, 93004]) {
  test(`${code} 配置类失败:立即失败不重试`, async () => {
    const { calls, fetchImpl } = stub(() => errReply(code, 'invalid webhook'));
    const sleeps = [];
    const res = await sendWecom('hi', { webhook: WEBHOOK, fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    assert.equal(res.ok, false);
    assert.equal(res.errcode, code);
    assert.match(res.error, new RegExp(String(code)));
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  });
}

test('超时按可重试处理:每次尝试都被 AbortController 中止', async () => {
  const signals = [];
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    signals.push(options.signal);
    options.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
  });
  const res = await sendWecom('hi', { webhook: WEBHOOK, fetchImpl, sleep: noSleep, retries: 1, timeoutMs: 15 });
  assert.equal(res.ok, false);
  assert.match(res.error, /abort/i);
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted === true));
});

test('超长多字节正文按字节截断:不超 2048 字节、不截半、不留替换字符', async () => {
  const long = '啊'.repeat(2000); // 6000 字节
  const { calls, fetchImpl } = stub(() => OK);
  const res = await sendWecom(long, { webhook: WEBHOOK, fetchImpl });
  assert.equal(res.ok, true);
  const content = bodyOf(calls[0]).text.content;
  assert.ok(Buffer.byteLength(content, 'utf8') <= 2048);
  assert.ok(content.endsWith('...'));
  assert.ok(!content.includes('\uFFFD'));
  assert.ok(long.startsWith(content.slice(0, -3)), '截断点必须落在字符边界上');
  assert.equal(truncateText('短文本'), '短文本');
});

test('key 掩码:发送正文与失败信息里都不出现 key 原文', async () => {
  const { calls, fetchImpl } = stub(() => OK);
  const res = await sendWecom(`看这个 ${WEBHOOK}`, { webhook: WEBHOOK, fetchImpl });
  assert.equal(res.ok, true);
  const content = bodyOf(calls[0]).text.content;
  assert.ok(!content.includes(KEY));
  assert.ok(content.includes('key=****'));
  assert.equal(maskSecret(WEBHOOK), `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=****`);

  const leaked = await sendWecom('hi', { webhook: WEBHOOK, sleep: noSleep, fetchImpl: async () => { throw new Error(`request to ${WEBHOOK} failed`); } });
  assert.equal(leaked.ok, false);
  assert.ok(!leaked.error.includes(KEY));
  assert.ok(leaked.error.includes('key=****'));
});

test('webhook 文件缺失:视为未配置,失败但不抛且不联网', async () => {
  const dir = tmp();
  const { calls, fetchImpl } = stub(() => OK);
  assert.equal(loadWebhook(path.join(dir, 'nope.txt')), '');
  const res = await sendWecom('hi', { webhookFile: path.join(dir, 'nope.txt'), fetchImpl });
  assert.equal(res.ok, false);
  assert.match(res.error, /未配置/);
  assert.equal(calls.length, 0);

  const file = path.join(dir, 'wecom-webhook.txt');
  fs.writeFileSync(file, `${WEBHOOK}\n`, 'utf8');
  assert.equal(loadWebhook(file), WEBHOOK);
  const ok = await sendWecom('hi', { webhookFile: file, fetchImpl });
  assert.equal(ok.ok, true);
});
