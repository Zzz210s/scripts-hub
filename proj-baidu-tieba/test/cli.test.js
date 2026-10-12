// Task 9 CLI 子命令:check 只读体检、report 当天汇总、run --dry 纯预览。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { main } from '../src/cli.js';
import { appendHistory } from '../src/state.js';
import { tiebaStub } from './tieba-stub.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-cli-'));
const NOW = new Date('2026-10-11T10:00:00');
const DAY = '2026-10-11';

function harness() {
  const lines = [];
  return { lines, log: (line) => lines.push(String(line)), join: () => lines.join('\n') };
}

test('check 打印逐账号 tbs、关注数、已签数与对账结论', async () => {
  const dir = tmp();
  const stub = tiebaStub({
    accounts: {
      'BDUSS=A': { forums: [{ fid: 1, kw: '吧一', isSign: true }, { fid: 2, kw: '吧二' }] },
      'BDUSS=B': { ok: false },
    },
  });
  const { lines, log, join } = harness();
  const code = await main(['check'], {
    cwd: dir,
    now: NOW,
    env: { ACCOUNT_1_BDUSS: 'A', ACCOUNT_2_BDUSS: 'B' },
    log,
    deps: { fetchImpl: stub.fetchImpl, freeMb: () => 4096 },
  });
  assert.equal(code, 1); // 有一个账号取不到 tbs
  assert.match(join(), /只读体检/);
  assert.match(join(), /账号 1 · tbs 可取 · 关注 2 个吧 · 已签 1 个/);
  assert.match(join(), /账号 2 · tbs 取不到/);
  assert.ok(lines.length >= 4);
});

test('report --dry 只打印当天记录,不发送', async () => {
  const dir = tmp();
  const stub = tiebaStub();
  const { join, log } = harness();
  const sent = [];
  const deps = { fetchImpl: stub.fetchImpl, send: async (text) => { sent.push(text); return { ok: true }; } };
  const env = { ACCOUNT_1_BDUSS: 'A' };
  const config = (await import('../src/config.js')).loadConfig(dir, { env });
  appendHistory({
    day: DAY,
    date: DAY,
    ok: true,
    reason: 'ok',
    missingTotal: 0,
    exitCode: 0,
    accounts: [{ name: '账号 1', ok: true, counts: { signed: 1, already: 0, blocked: 0, tbsStale: 0, failed: 0 }, error: null, reason: 'ok' }],
    reconcile: { ok: true, perAccount: [], missingTotal: 0, blockedTotal: 0, truncated: false, emptyForums: false, expectedEmpty: false, unresolvedAccounts: [], reasons: ['ok'], reason: 'ok', error: null },
  }, config.stateDir, { now: NOW });
  const dry = await main(['report', '--dry'], { cwd: dir, now: NOW, env, log, deps });
  assert.equal(dry, 0);
  assert.match(join(), /运行成功/);
  assert.equal(sent.length, 0);
  const real = await main(['report'], { cwd: dir, now: NOW, env, log, deps });
  assert.equal(real, 0);
  assert.equal(sent.length, 1);
});

test('run --dry 走 CLI 时不发送、不联网', async () => {
  const dir = tmp();
  const stub = tiebaStub({ accounts: { 'BDUSS=A': { forums: [{ fid: 1, kw: '吧一' }] } } });
  const { join, log } = harness();
  const sent = [];
  const code = await main(['run', '--dry'], {
    cwd: dir,
    now: NOW,
    env: { ACCOUNT_1_BDUSS: 'A' },
    log,
    deps: { fetchImpl: stub.fetchImpl, send: async (text) => { sent.push(text); return { ok: true }; }, freeMb: () => 4096 },
  });
  assert.equal(code, 0);
  assert.match(join(), /预览,未运行/);
  assert.equal(sent.length, 0);
  assert.equal(stub.calls.length, 0);
});
