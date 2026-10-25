// 逐吧明细在真实编排里的接线:结果消息之后是否真的多发一条、开关是否生效、字符是否合规。
// 与 run.test.js 分开,避免单文件超 200 行。全部离线:协议桩 + 注入发送器。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConfig } from '../src/config.js';
import { runOnce } from '../src/run.js';
import { tiebaStub } from './tieba-stub.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-detail-'));
const NOW = new Date('2026-10-25T10:00:00');
const noSleep = async () => {};
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

test('结果消息之后多发一条逐吧明细:一行一个吧并带等级', async () => {
  const { sent } = await run({
    forums: [
      { fid: 11, kw: '吧一', level: 8 },
      { fid: 12, kw: '吧二', level: 12 },
      { fid: 13, kw: '吧三', level: null },
    ],
  });
  assert.equal(sent.length, 3); // start + result + detail
  const detail = sent[2];
  assert.ok(detail.startsWith('百度贴吧签到 · 2026-10-25 · 签到明细'), detail.split('\n')[0]);
  // 等级高的在前;等级取不到的写 Lv?
  const lines = detail.split('\n');
  assert.ok(lines.includes('吧二 Lv12'), detail);
  assert.ok(lines.includes('吧一 Lv8'), detail);
  assert.ok(lines.includes('吧三 Lv?'), detail);
  assert.ok(lines.indexOf('吧二 Lv12') < lines.indexOf('吧一 Lv8'), '应按等级从高到低');
  assert.ok(detail.includes('已签 3 个'), detail);
});

test('TIEBA_DETAIL=0 时不发明细,回到两条消息', async () => {
  const { sent } = await run({ forums: [{ fid: 11, kw: '吧一' }], env: { TIEBA_DETAIL: '0' } });
  assert.equal(sent.length, 2); // start + result
  assert.equal(sent.some((text) => text.includes('签到明细')), false);
});

test('TIEBA_DETAIL_MAX 生效:只列 N 个并说明还剩多少', async () => {
  const forums = Array.from({ length: 6 }, (_, i) => ({ fid: 100 + i, kw: `吧${i + 1}`, level: i + 1 }));
  const { sent } = await run({ forums, env: { TIEBA_DETAIL_MAX: '3' } });
  const detail = sent[2];
  assert.equal(detail.split('\n').filter((line) => /^吧\d+ Lv\d+$/.test(line)).length, 3);
  assert.ok(detail.includes('已签 6 个'), detail);
  assert.ok(detail.includes('另有 3 个未列出'), detail);
});

test('--dry 不发任何消息,自然也没有明细', async () => {
  const { sent, result } = await run({ forums: [{ fid: 11, kw: '吧一' }], dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(sent.length, 0);
});

test('明细消息同样守硬规则:无圆括号、无 emoji', async () => {
  const { sent } = await run({
    forums: [
      { fid: 11, kw: '吧A(外语)\u{1F600}', level: 8 },
      { fid: 12, kw: '屏蔽\u{2B50}', level: 3, isForbidden: true },
    ],
  });
  const detail = sent[2];
  assert.equal(hasParen(detail), false, detail);
  assert.equal(hasEmoji(detail), false, detail);
});
