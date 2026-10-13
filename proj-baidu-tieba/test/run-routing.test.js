// 守卫的推送路由与开跑前记尝试次数:静默集合不推送,其余守卫推一条需要处理的 action。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConfig } from '../src/config.js';
import { runOnce } from '../src/run.js';
import { attemptsOn, emptyState, readState, setPaused, writeState } from '../src/state.js';
import { tiebaStub } from './tieba-stub.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-run-route-'));
const NOW = new Date('2026-10-11T10:00:00');
const DAY = '2026-10-11';
const noSleep = async () => {};

async function run({ dir, stub, env = { ACCOUNT_1_BDUSS: 'A' }, now = NOW, freeMb, state }) {
  const config = loadConfig(dir, { env });
  if (state) writeState(state, config.stateDir, now);
  const sent = [];
  const logs = [];
  const result = await runOnce({
    cwd: dir,
    now,
    deps: {
      config,
      fetchImpl: stub.fetchImpl,
      sleep: noSleep,
      freeMb,
      send: async (text) => {
        sent.push(text);
        return { ok: true };
      },
      log: (line) => logs.push(line),
    },
  });
  return { result, sent, logs, config };
}

test('安静时段属静默集合 → 不推送也不联网', async () => {
  const dir = tmp();
  const stub = tiebaStub();
  const { result, sent, logs } = await run({ dir, stub, now: new Date('2026-10-11T21:00:00') });
  assert.equal(result.reason, 'quiet-hours');
  assert.equal(result.skipped, true);
  assert.equal(sent.length, 0);
  assert.equal(stub.calls.length, 0);
  assert.ok(logs.some((line) => line.includes('正常跳过')));
});

test('全部凭据失效 → 推 action 且带逐账号错误细节', async () => {
  const dir = tmp();
  const stub = tiebaStub({ accounts: { 'BDUSS=A': { ok: false }, 'BDUSS=B': { ok: false } } });
  const env = { ACCOUNT_1_BDUSS: 'A', ACCOUNT_2_BDUSS: 'B' };
  const { result, sent } = await run({ dir, stub, env });
  assert.equal(result.reason, 'credentials-invalid');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /需要你处理/);
  assert.match(sent[0], /细节:/);
  assert.match(sent[0], /未登录或凭据已失效/);
});

test('手动暂停 → 静默跳过,不推送', async () => {
  const dir = tmp();
  const stub = tiebaStub();
  const state = emptyState(NOW);
  setPaused(state, true);
  const { result, sent, logs } = await run({ dir, stub, state });
  assert.equal(result.reason, 'paused');
  assert.equal(sent.length, 0);
  assert.ok(logs.some((line) => line.includes('正常跳过')));
});

test('可用内存不足 → 静默跳过,不推送', async () => {
  const dir = tmp();
  const stub = tiebaStub();
  const { result, sent, logs } = await run({ dir, stub, freeMb: () => 10 });
  assert.equal(result.reason, 'low-memory');
  assert.equal(sent.length, 0);
  assert.ok(logs.some((line) => line.includes('正常跳过')));
});

test('临近关机时刻 → 推 action', async () => {
  const dir = tmp();
  const stub = tiebaStub();
  const { result, sent } = await run({ dir, stub, now: new Date('2026-10-12T01:45:00') });
  assert.equal(result.reason, 'before-shutdown');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /临近关机时刻/);
});

test('没注入发送器 → 投递结果显式记为失败,不伪装成已发送', async () => {
  const dir = tmp();
  const stub = tiebaStub({ accounts: { 'BDUSS=A': { forums: [{ fid: 11, kw: '吧一' }] } } });
  const config = loadConfig(dir, { env: { ACCOUNT_1_BDUSS: 'A' } });
  const result = await runOnce({
    cwd: dir,
    now: NOW,
    deps: { config, fetchImpl: stub.fetchImpl, sleep: noSleep, log: () => {} },
  });
  assert.equal(result.ok, true); // 签到本身成功
  assert.equal(result.deliveries.length, 2);
  assert.ok(result.deliveries.every((one) => one.ok === false));
  assert.equal(result.lastDelivery.error, '没有注入发送器');
});

test('开跑前就记下一次尝试 → 第一次发送时状态里已有 attempts 1', async () => {
  const dir = tmp();
  const stub = tiebaStub({ accounts: { 'BDUSS=A': { forums: [{ fid: 11, kw: '吧一' }] } } });
  const config = loadConfig(dir, { env: { ACCOUNT_1_BDUSS: 'A' } });
  let atFirstSend = null;
  await runOnce({
    cwd: dir,
    now: NOW,
    deps: {
      config,
      fetchImpl: stub.fetchImpl,
      sleep: noSleep,
      send: async () => {
        atFirstSend ??= readState(config.stateDir).state;
        return { ok: true };
      },
      log: () => {},
    },
  });
  assert.equal(attemptsOn(atFirstSend, DAY), 1);
});
