// Task 7:单实例锁与同伴互查。全部离线:exec 是桩、isAlive 是桩,不读真实进程表。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { peerBusy } from '../src/guards.js';
import { acquireLock, defaultIsAlive, lockFile, readLock, releaseLock, writeLock } from '../src/lock.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-lock-'));

test('peerBusy:以同伴自己的 lock-status 为准,RUNNING 才让路', () => {
  const dir = tmpDir();
  const lock = path.join(dir, 'proj-peer', 'logs', 'run.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  // 同伴的 lock-status 入口存在,exec 才会被调用。
  const script = path.join(dir, 'proj-peer', 'scripts', 'windows', 'run-state.js');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, '', 'utf8');
  fs.writeFileSync(lock, JSON.stringify({ pid: 1, startedAt: new Date(0).toISOString() }), 'utf8');

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
  const dir = tmpDir();
  const lock = path.join(dir, 'proj-peer', 'logs', 'run.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: 1, startedAt: new Date(0).toISOString() }), 'utf8');

  const boom = () => {
    throw new Error('lock-status 查不通');
  };
  const fresh = peerBusy([lock], { exec: boom, nowMs: fs.statSync(lock).mtimeMs + 60000 });
  assert.equal(fresh.busy, true);
  assert.match(fresh.detail, /可能刚启动/);

  const old = peerBusy([lock], { exec: boom, nowMs: fs.statSync(lock).mtimeMs + 3600000 });
  assert.equal(old.busy, false);
});

test('defaultIsAlive:自己的进程活着,非法 pid 判死', () => {
  assert.equal(defaultIsAlive(process.pid), true);
  assert.equal(defaultIsAlive(0), false);
  assert.equal(defaultIsAlive(-1), false);
  assert.equal(defaultIsAlive('x'), false);
});

test('defaultIsAlive:确定已死的 pid 判死,EPERM 算活着', () => {
  // 跑一个立即退出的子进程,拿到一个确定已结束的真实 pid。
  const exited = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  assert.equal(Number.isInteger(exited.pid), true);
  assert.equal(defaultIsAlive(exited.pid), false);

  // 探活系统调用直接抛错时,看错误码:EPERM = 进程在但不属于我们。
  const withKill = (code, fn) => {
    const original = process.kill;
    process.kill = () => {
      const error = new Error('stub');
      error.code = code;
      throw error;
    };
    try {
      return fn();
    } finally {
      process.kill = original;
    }
  };
  assert.equal(withKill('EPERM', () => defaultIsAlive(1234)), true);
  assert.equal(withKill('ESRCH', () => defaultIsAlive(1234)), false);
});

test('acquireLock:没锁就拿到;活着的持有者挡住;残锁立即回收', () => {
  const dir = tmpDir();
  const file = lockFile(dir);
  const now = new Date('2026-10-11T09:00:00');

  const first = acquireLock(dir, { now });
  assert.deepEqual(first, {
    ok: true,
    stale: false,
    holder: { pid: process.pid, host: os.hostname(), startedAt: now.toISOString() },
  });
  assert.equal(readLock(file).pid, process.pid);

  const blocked = acquireLock(dir, { now });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.holder.pid, process.pid);

  // 进程已不存在的锁 = 残锁,直接接管而不是等到锁过期。
  const stale = acquireLock(dir, { now, pid: 4242, isAlive: () => false });
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(readLock(file).pid, 4242);

  releaseLock(dir, { pid: 4242 }); // 当前持有者是 4242,只有它能释放
  assert.equal(fs.existsSync(file), false);
  assert.equal(acquireLock(dir, { now }).ok, true);
});

test('acquireLock:空文件或坏内容的锁当成残锁,不当成活持有者', () => {
  const dir = tmpDir();
  const file = lockFile(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '', 'utf8');
  const taken = acquireLock(dir);
  assert.equal(taken.ok, true);
  assert.equal(taken.stale, true);
  assert.equal(readLock(file).pid, process.pid);

  fs.writeFileSync(file, 'not json', 'utf8');
  assert.equal(acquireLock(dir).stale, true);
});

test('acquireLock:host 不同的锁即使 pid 活着也当残锁回收', () => {
  const dir = tmpDir();
  const file = lockFile(dir);
  const now = new Date('2026-10-11T09:00:00');
  // 上一次运行在别的容器里留下锁,它的 pid 恰好被本容器复用了(用当前进程 pid 模拟)。
  writeLock(file, { now, pid: process.pid, hostname: 'container-old' });
  assert.equal(defaultIsAlive(process.pid), true);

  const taken = acquireLock(dir, { now, hostname: 'container-new' });
  assert.equal(taken.ok, true);
  assert.equal(taken.stale, true);
  assert.equal(readLock(file).host, 'container-new');
});

test('releaseLock:持有者不是自己时不删别人的锁', () => {
  const dir = tmpDir();
  const file = lockFile(dir);
  writeLock(file, { now: new Date(), pid: 4242, hostname: 'container-other' });
  const denied = releaseLock(dir, { pid: process.pid, hostname: 'container-new' });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'not-holder');
  assert.equal(fs.existsSync(file), true);

  assert.equal(releaseLock(dir, { pid: 4242, hostname: 'container-other' }).ok, true);
  assert.equal(fs.existsSync(file), false);
});

test('writeLock:锁里记 pid、host 与开始时间', () => {
  const dir = tmpDir();
  const now = new Date('2026-10-11T09:00:00');
  writeLock(lockFile(dir), { now, pid: 7, hostname: 'box-a' });
  assert.deepEqual(readLock(lockFile(dir)), { pid: 7, host: 'box-a', startedAt: now.toISOString() });
});
