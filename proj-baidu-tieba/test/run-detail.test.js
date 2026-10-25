// 逐吧明细在真实编排里的接线:每天**只发两条**(开始运行 + 运行结果),明细并进结果里。
// 与 run.test.js 分开,避免单文件超 200 行。全部离线:协议桩 + 注入发送器。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConfig } from '../src/config.js';
import { LIMIT_BYTES } from '../src/messages.js';
import { runOnce } from '../src/run.js';
import { tiebaStub } from './tieba-stub.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-detail-'));
const NOW = new Date('2026-10-25T10:00:00');
const noSleep = async () => {};
const bytes = (text) => Buffer.byteLength(text, 'utf8');
const hasParen = (text) => /[()\uFF08\uFF09]/.test(text);
const hasEmoji = (text) => /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u.test(text);

async function run({ forums, env = {}, dryRun = false }) {
  const dir = tmp();
  const stub = tiebaStub({ accounts: { 'BDUSS=A': { forums } } });
  const config = loadConfig(dir, { env: { ACCOUNT_1_BDUSS: 'A', ...env } });
  const sent = [];
  const result = await runOnce({
    cwd: dir,
    now: NOW,
    dryRun,
    deps: {
      config,
      fetchImpl: stub.fetchImpl,
      sleep: noSleep,
      send: async (text) => {
        sent.push(text);
        return { ok: true };
      },
      log: () => {},
    },
  });
  return { result, sent, config };
}

test('每天只发两条:开始运行 + 运行结果,明细并进结果里', async () => {
  const { sent } = await run({
    forums: [
      { fid: 11, kw: '吧一', level: 8 },
      { fid: 12, kw: '吧二', level: 12 },
      { fid: 13, kw: '吧三', level: null },
    ],
  });
  assert.equal(sent.length, 2, `应只有 start 与 result,实际 ${sent.length} 条`);
  assert.ok(sent[0].includes('开始运行'), sent[0]);
  const result = sent[1];
  assert.ok(result.includes('运行成功'), result.split('\n')[0]);
  // 明细在结果里:按等级分组,等级高的在前,未知等级写 Lv?
  assert.ok(result.includes('Lv12 吧二'), result);
  assert.ok(result.includes('Lv8 吧一'), result);
  assert.ok(result.includes('Lv? 吧三'), result);
  assert.ok(result.indexOf('Lv12 ') < result.indexOf('Lv8 '), '应按等级从高到低');
  // 两条都不超过单条上限
  for (const text of sent) assert.ok(bytes(text) <= LIMIT_BYTES, `${bytes(text)} 字节超限`);
});

test('136 个吧:结果消息仍是一条,≤ 2048 字节,吧一个不丢', async () => {
  const forums = Array.from({ length: 136 }, (_, index) => ({ fid: 100 + index, kw: `贴吧${index + 1}`, level: (index % 5) + 4 }));
  const { sent } = await run({ forums });
  assert.equal(sent.length, 2);
  const result = sent[1];
  assert.ok(bytes(result) <= LIMIT_BYTES, `结果消息 ${bytes(result)} 字节超限`);
  const missing = forums.filter((forum) => !result.includes(forum.kw));
  assert.equal(missing.length, 0, `有 ${missing.length} 个吧没被列出`);
});

test('TIEBA_DETAIL=0 时结果里不列明细,仍然只有两条消息', async () => {
  const { sent } = await run({ forums: [{ fid: 11, kw: '吧一', level: 8 }], env: { TIEBA_DETAIL: '0' } });
  assert.equal(sent.length, 2);
  assert.equal(/Lv\d+ 吧/.test(sent[1]), false, sent[1]);
  assert.ok(sent[1].includes('对账:通过'), sent[1]);
});

test('TIEBA_DETAIL_MAX 生效:只列 N 个并说明还剩多少', async () => {
  const forums = Array.from({ length: 6 }, (_, i) => ({ fid: 100 + i, kw: `吧${i + 1}`, level: 8 }));
  const { sent } = await run({ forums, env: { TIEBA_DETAIL_MAX: '3' } });
  const result = sent[1];
  assert.ok(result.includes('Lv8 吧1'), result);
  assert.equal(result.includes('吧4'), false, result);
  assert.match(result, /另有 3 个未列出 · 按等级从高到低/);
});

test('--dry 不发任何消息', async () => {
  const { sent, result } = await run({ forums: [{ fid: 11, kw: '吧一' }], dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(sent.length, 0);
});

test('两条消息都守硬规则:无圆括号、无 emoji', async () => {
  const { sent } = await run({
    forums: [
      { fid: 11, kw: '吧A(外语)\u{1F600}', level: 8 },
      { fid: 12, kw: '屏蔽\u{2B50}', level: 3, isForbidden: true },
    ],
  });
  for (const text of sent) {
    assert.equal(hasParen(text), false, text);
    assert.equal(hasEmoji(text), false, text);
  }
});
