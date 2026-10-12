// Task 7 的同伴互查与锁状态三态:全部离线,exec 是桩、isAlive 是桩,不读真实进程表。
// 与 lock.test.js(取锁/释放锁)分开,守住单文件 200 行上限(全局规则 A17)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { peerBusy } from '../src/guards.js';
import { lockState } from '../src/lock.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-peer-'));

/** 造一个「同伴项目」:锁在 logs/run.lock,判定入口在 scripts/windows/run-state.js。 */
const peerFixture = (holder) => {
  const dir = tmpDir();
  const lock = path.join(dir, 'proj-peer', 'logs', 'run.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify(holder), 'utf8');
  const script = path.join(dir, 'proj-peer', 'scripts', 'windows', 'run-state.js');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '', 'utf8');
  return { dir, lock };
};

test('peerBusy:以同伴自己的 lock-status 为准,RUNNING 才让路', () => {
  const { dir, lock } = peerFixture({ pid: 1, startedAt: new Date(0).toISOString() });
  const exec = (verdict) => () => verdict;
  assert.deepEqual(peerBusy([lock], { exec: exec('RUNNING') }), {
    busy: true,
    project: 'proj-peer',
    detail: 'proj-peer 正在运行',
  });
  assert.equal(peerBusy([lock], { exec: exec('STALE') }).busy, false);
  assert.equal(peerBusy([lock], { exec: exec('NONE') }).busy, false);
  assert.equal(peerBusy([], { exec: exec('RUNNING') }).busy, false);
  assert.equal(peerBusy([path.join(dir, 'absent.lock')], { exec: exec('RUNNING') }).busy, false);
});

test('peerBusy:查不通时只有 10 分钟内的新锁保守让路', () => {
  const { lock } = peerFixture({ pid: 1, startedAt: new Date(0).toISOString() });
  const boom = () => {
    throw new Error('lock-status 查不通');
  };
  const fresh = peerBusy([lock], { exec: boom, nowMs: fs.statSync(lock).mtimeMs + 60000 });
  assert.equal(fresh.busy, true);
  assert.match(fresh.detail, /可能刚启动/);

  const old = peerBusy([lock], { exec: boom, nowMs: fs.statSync(lock).mtimeMs + 3600000 });
  assert.equal(old.busy, false);
});

test('lockState:host 相同看进程实况,host 不同一律 unknown', () => {
  const opts = { isAlive: (pid) => pid === 111, hostname: 'box-a' };
  assert.equal(lockState(null, opts), 'stale');
  assert.equal(lockState({ pid: 111, host: 'box-a' }, opts), 'running');
  assert.equal(lockState({ pid: 222, host: 'box-a' }, opts), 'stale');
  // 别的容器/机器写的锁:本机看不到它的进程表,既不能证明活也不能证明死。
  assert.equal(lockState({ pid: 111, host: 'container-old' }, opts), 'unknown');
  assert.equal(lockState({ pid: 111 }, opts), 'running'); // 老锁没写 host,按本机判
});

test('peerBusy:UNKNOWN 按锁年龄保守让路,不当作残锁放行', () => {
  const { lock } = peerFixture({ pid: 1, host: 'container-other', startedAt: new Date(0).toISOString() });
  const exec = () => 'UNKNOWN';

  const fresh = peerBusy([lock], { exec, nowMs: fs.statSync(lock).mtimeMs + 60000 });
  assert.equal(fresh.busy, true);
  assert.match(fresh.detail, /锁状态未知/);

  const old = peerBusy([lock], { exec, nowMs: fs.statSync(lock).mtimeMs + 3600000 });
  assert.equal(old.busy, false);
});

test('run-state lock-status:host 不同输出 UNKNOWN,不再误报 STALE', () => {
  const projectDir = path.resolve(import.meta.dirname, '..');
  const script = path.join(projectDir, 'scripts', 'windows', 'run-state.js');
  const dir = tmpDir();
  const run = () =>
    spawnSync(process.execPath, [script, 'lock-status'], {
      encoding: 'utf8',
      env: { ...process.env, TIEBA_LOCK_DIR: dir },
    }).stdout.trim();

  assert.equal(run(), 'NONE');
  fs.writeFileSync(path.join(dir, 'run.lock'), JSON.stringify({ pid: 4242, host: os.hostname() }), 'utf8');
  assert.equal(run(), 'STALE');
  fs.writeFileSync(path.join(dir, 'run.lock'), JSON.stringify({ pid: process.pid, host: os.hostname() }), 'utf8');
  assert.equal(run(), 'RUNNING');
  fs.writeFileSync(path.join(dir, 'run.lock'), JSON.stringify({ pid: process.pid, host: 'container-other' }), 'utf8');
  assert.equal(run(), 'UNKNOWN');
});
