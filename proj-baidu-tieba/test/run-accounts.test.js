// 重名账号回归:两个 ACCOUNT_n_NAME 同名时,链路必须以唯一 id 为键 —— 用显示名当键会让
// 靠后的账号覆盖靠前的,轻则可用账号整天不签,重则把漏签误报成 ok:true 并锁死当天。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConfig } from '../src/config.js';
import { runOnce } from '../src/run.js';
import { doneToday, readState } from '../src/state.js';
import { tiebaStub } from './tieba-stub.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-run-dup-'));
const NOW = new Date('2026-10-11T10:00:00');
const DAY = '2026-10-11';
const noSleep = async () => {};
const SAME = {
  ACCOUNT_1_BDUSS: 'A',
  ACCOUNT_2_BDUSS: 'B',
  ACCOUNT_1_NAME: '同名',
  ACCOUNT_2_NAME: '同名',
};

async function run({ dir, stub, env = SAME }) {
  const config = loadConfig(dir, { env });
  const sent = [];
  const result = await runOnce({
    cwd: dir,
    now: NOW,
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

test('重名账号的 id 互不相同,显示名也自动消歧', () => {
  const config = loadConfig('/no/such/dir', { env: SAME });
  assert.equal(new Set(config.accounts.map((one) => one.id)).size, 2);
  assert.equal(new Set(config.accounts.map((one) => one.name)).size, 2);
  assert.equal(config.accounts[0].name, '同名');
  assert.equal(config.accounts[1].name, '同名 #2');
});

test('A 失效 B 可用且同名 → B 照签,两条对账各自归位,当天不锁', async () => {
  const dir = tmp();
  const stub = tiebaStub({
    accounts: { 'BDUSS=A': { ok: false }, 'BDUSS=B': { forums: [{ fid: 22, kw: '吧二' }] } },
  });
  const { result, config } = await run({ dir, stub });
  assert.equal(stub.seen.sign.length, 1); // 旧实现这里恒为 0:可用账号被当成失效
  assert.equal(stub.seen.sign[0].cookie, 'BDUSS=B');
  assert.equal(result.reconcile.perAccount.length, 2); // 旧实现只剩一条
  assert.equal(result.reconcile.perAccount.filter((one) => one.ok === true).length, 1);
  assert.equal(result.reconcile.perAccount.filter((one) => one.ok === null).length, 1);
  assert.notEqual(result.reconcile.ok, true);
  const { state } = readState(config.stateDir);
  assert.equal(doneToday(state, DAY), false);
});

test('靠后账号签全不能把靠前账号的漏签洗成成功', async () => {
  const dir = tmp();
  // 两个账号都拿得到 tbs;A 的签到不被贴吧认账,读回 is_sign 仍是 0。
  const stub = tiebaStub({
    accounts: {
      'BDUSS=A': { forums: [{ fid: 11, kw: '吧一' }], honorSign: false },
      'BDUSS=B': { forums: [{ fid: 22, kw: '吧二' }] },
    },
  });
  const { result, config } = await run({ dir, stub });
  assert.equal(stub.seen.sign.length, 2);
  assert.equal(result.reconcile.ok, false); // 旧实现被 B 的读回覆盖 → ok:true → 当天锁死
  assert.equal(result.reconcile.missingTotal, 1);
  const { state } = readState(config.stateDir);
  assert.equal(doneToday(state, DAY), false);
});

test('重名账号两个都签全 → 对账通过并锁当天', async () => {
  const dir = tmp();
  const stub = tiebaStub({
    accounts: {
      'BDUSS=A': { forums: [{ fid: 11, kw: '吧一' }] },
      'BDUSS=B': { forums: [{ fid: 22, kw: '吧二' }] },
    },
  });
  const { result, config } = await run({ dir, stub });
  assert.equal(result.reconcile.perAccount.length, 2);
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  const { state } = readState(config.stateDir);
  assert.equal(doneToday(state, DAY), true);
});
