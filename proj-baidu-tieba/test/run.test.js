// Task 9 集成测试:全部离线,网络用 tieba-stub 桩,时间/发送/内存/同伴从 deps 注入。
// 四条核心回归:对账通过锁当天、对账不通过不锁、单账号失效不静默通过、--dry 只预览。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConfig } from '../src/config.js';
import { runOnce } from '../src/run.js';
import { doneToday, emptyState, historyFile, readState, stateFile, writeState } from '../src/state.js';
import { tiebaStub } from './tieba-stub.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-run-'));
const NOW = new Date('2026-10-11T10:00:00');
const DAY = '2026-10-11';
const noSleep = async () => {};

async function run({ dir, stub, env = { ACCOUNT_1_BDUSS: 'A' }, now = NOW, dryRun = false, peer, state }) {
  const config = loadConfig(dir, { env });
  if (state) writeState(state, config.stateDir, now);
  const sent = [];
  const logs = [];
  const result = await runOnce({
    cwd: dir,
    now,
    dryRun,
    deps: {
      config,
      fetchImpl: stub.fetchImpl,
      sleep: noSleep,
      send: async (text) => { sent.push(text); return { ok: true }; },
      log: (line) => logs.push(line),
      peerRunning: peer ? () => peer : undefined,
    },
  });
  return { result, sent, logs, config };
}

test('对账通过 → ok true 且当天锁定', async () => {
  const dir = tmp();
  const stub = tiebaStub({ accounts: { 'BDUSS=A': { forums: [{ fid: 11, kw: '吧一' }] } } });
  const { result, sent, config } = await run({ dir, stub });
  assert.equal(result.skipped, false);
  assert.equal(result.reconcile.ok, true);
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(sent.length, 2); // start + result
  const { state } = readState(config.stateDir);
  assert.equal(doneToday(state, DAY), true);
  assert.equal(state.days[DAY].attempts, 1);
});

test('对账不通过 → 当天不锁,只记一次失败尝试', async () => {
  const dir = tmp();
  const stub = tiebaStub({ accounts: { 'BDUSS=A': { forums: [{ fid: 11, kw: '吧一' }] } }, honorSign: false });
  const { result, config } = await run({ dir, stub });
  assert.equal(result.reconcile.ok, false);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  const { state } = readState(config.stateDir);
  assert.equal(doneToday(state, DAY), false);
  assert.equal(state.days[DAY].ok, false);
  assert.equal(state.days[DAY].attempts, 1);
});

test('一个账号凭据失效 → 其余照签,整体不静默通过且不锁当天', async () => {
  const dir = tmp();
  const stub = tiebaStub({
    accounts: { 'BDUSS=A': { ok: false }, 'BDUSS=B': { forums: [{ fid: 22, kw: '吧二' }] } },
  });
  const { result, config } = await run({ dir, stub, env: { ACCOUNT_1_BDUSS: 'A', ACCOUNT_2_BDUSS: 'B' } });
  assert.notEqual(result.reconcile.ok, true);
  assert.equal(result.reconcile.ok, null); // 缺一个账号的读回 → 无法判定
  assert.equal(result.ok, false);
  assert.equal(result.reconcile.perAccount.find((one) => one.name === '账号 2').ok, true);
  assert.equal(stub.seen.sign.length, 1); // 只签了可用的账号
  assert.equal(stub.seen.sign[0].cookie, 'BDUSS=B');
  const { state } = readState(config.stateDir);
  assert.equal(doneToday(state, DAY), false);
});

test('--dry 不联网、不发送、不写状态、不耗尝试次数', async () => {
  const dir = tmp();
  const stub = tiebaStub({ accounts: { 'BDUSS=A': { forums: [{ fid: 11, kw: '吧一' }] } } });
  const { result, sent, logs, config } = await run({ dir, stub, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(stub.calls.length, 0);
  assert.equal(stub.seen.sign.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(fs.existsSync(stateFile(config.stateDir)), false);
  assert.ok(logs.length > 0);
});

test('TIEBA_DRY_RUN=1 也强制预览,不联网不落盘', async () => {
  const dir = tmp();
  const stub = tiebaStub({ accounts: { 'BDUSS=A': { forums: [{ fid: 11, kw: '吧一' }] } } });
  const { result, sent, config } = await run({ dir, stub, env: { ACCOUNT_1_BDUSS: 'A', TIEBA_DRY_RUN: '1' } });
  assert.equal(result.dryRun, true);
  assert.equal(stub.calls.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(fs.existsSync(stateFile(config.stateDir)), false);
});

test('当天已完成 → 静默跳过,不发送', async () => {
  const dir = tmp();
  const stub = tiebaStub();
  const state = emptyState(NOW);
  state.days[DAY] = { attempts: 1, ok: true, checkedAt: NOW.toISOString() };
  const { result, sent, logs } = await run({ dir, stub, state });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'done-today');
  assert.equal(sent.length, 0);
  assert.ok(logs.length > 0);
  assert.equal(stub.calls.length, 0);
});

test('同伴在跑 → 静默跳过,不联网', async () => {
  const dir = tmp();
  const stub = tiebaStub();
  const { result, sent } = await run({ dir, stub, peer: { busy: true, detail: '别的程序' } });
  assert.equal(result.reason, 'peer-running');
  assert.equal(sent.length, 0);
  assert.equal(stub.calls.length, 0);
});

test('尝试次数用尽 → 仍然推送一条需要处理的 action', async () => {
  const dir = tmp();
  const stub = tiebaStub();
  const state = emptyState(NOW);
  state.days[DAY] = { attempts: 3, ok: false, checkedAt: NOW.toISOString() };
  const { result, sent } = await run({ dir, stub, state });
  assert.equal(result.reason, 'attempts-exhausted');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /需要你处理/);
});

test('没有账号 → 推送一条请你配置 BDUSS 的 action', async () => {
  const dir = tmp();
  const stub = tiebaStub();
  const { result, sent } = await run({ dir, stub, env: {} });
  assert.equal(result.reason, 'no-credentials');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /BDUSS/);
});

test('账号级流程失败但读回显示全签 → 对账仍通过并锁当天', async () => {
  const dir = tmp();
  // 第 2 次会话请求(签到前那次)回 500,让 signAccount 记 ok:false;随后的读回成功且 is_sign 为 1。
  const stub = tiebaStub({
    accounts: { 'BDUSS=A': { forums: [{ fid: 11, kw: '吧一', isSign: true }], sessionFailAt: [2] } },
  });
  const { result, config } = await run({ dir, stub });
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  const { state } = readState(config.stateDir);
  assert.equal(doneToday(state, DAY), true);
  const rows = fs.readFileSync(historyFile(config.stateDir), 'utf8').trim().split('\n');
  const entry = JSON.parse(rows[rows.length - 1]);
  assert.equal(entry.ok, true);
  assert.equal(entry.accounts[0].ok, false);
});
