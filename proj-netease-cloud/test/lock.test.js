// T7:单实例锁(取锁/释放锁/三态)。全部离线:isAlive 是桩,不读真实进程表。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  acquireLock,
  clearLock,
  defaultIsAlive,
  holderAlive,
  lockFile,
  lockState,
  readLock,
  releaseLock,
  writeLock,
} from '../src/lock.js'

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'netease-lock-'))

test('defaultIsAlive:自己的进程活着,非法 pid 判死,EPERM 算活着', () => {
  assert.equal(defaultIsAlive(process.pid), true)
  assert.equal(defaultIsAlive(0), false)
  assert.equal(defaultIsAlive('x'), false)

  const exited = spawnSync(process.execPath, ['-e', ''], { windowsHide: true })
  assert.equal(defaultIsAlive(exited.pid), false)

  const original = process.kill
  process.kill = () => {
    const error = new Error('stub')
    error.code = 'EPERM'
    throw error
  }
  try {
    assert.equal(defaultIsAlive(1234), true)
  } finally {
    process.kill = original
  }
})

test('lockState:三态按 host 与进程实况判定', () => {
  const holder = { pid: process.pid, host: 'box-a' }
  assert.equal(lockState(holder, { hostname: 'box-a' }), 'running')
  assert.equal(lockState(holder, { hostname: 'box-a', isAlive: () => false }), 'stale')
  // 别的容器/机器留下的锁:本机看不到它的进程表,既不能说活着也不能说是残锁。
  assert.equal(lockState(holder, { hostname: 'box-b' }), 'unknown')
  assert.equal(lockState(null), 'stale')
  // 取锁方口径:unknown 当残锁回收(holderAlive 只看 running)。
  assert.equal(holderAlive(holder, { hostname: 'box-b' }), false)
  assert.equal(holderAlive(holder, { hostname: 'box-a' }), true)
})

test('acquireLock:没锁就拿到;活着的持有者挡住;残锁立即回收', () => {
  const dir = tmpDir()
  const file = lockFile(dir)
  const now = new Date('2026-10-11T09:00:00')

  const first = acquireLock(dir, { now })
  assert.deepEqual(first, {
    ok: true,
    stale: false,
    holder: { pid: process.pid, host: os.hostname(), startedAt: now.toISOString() },
  })

  const blocked = acquireLock(dir, { now })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.holder.pid, process.pid)

  const stale = acquireLock(dir, { now, pid: 4242, isAlive: () => false })
  assert.equal(stale.ok, true)
  assert.equal(stale.stale, true)
  assert.equal(readLock(file).pid, 4242)

  releaseLock(dir, { pid: 4242 })
  assert.equal(fs.existsSync(file), false)
})

test('acquireLock:空文件、坏内容、跨 host 的锁都当残锁回收', () => {
  const dir = tmpDir()
  const file = lockFile(dir)
  writeLock(file, { now: new Date(), pid: process.pid, hostname: 'container-old' })
  assert.equal(defaultIsAlive(process.pid), true)

  const taken = acquireLock(dir, { now: new Date(), hostname: 'container-new' })
  assert.equal(taken.ok, true)
  assert.equal(taken.stale, true)
  assert.equal(readLock(file).host, 'container-new')

  fs.writeFileSync(file, '', 'utf8')
  assert.equal(acquireLock(dir).stale, true)
  fs.writeFileSync(file, 'not json', 'utf8')
  assert.equal(acquireLock(dir).stale, true)
})

test('releaseLock:持有者不是自己时不删别人的锁', () => {
  const dir = tmpDir()
  const file = lockFile(dir)
  writeLock(file, { now: new Date(), pid: 4242, hostname: 'container-other' })
  const denied = releaseLock(dir, { pid: process.pid, hostname: 'container-new' })
  assert.equal(denied.ok, false)
  assert.equal(denied.reason, 'not-holder')
  assert.equal(fs.existsSync(file), true)

  assert.equal(releaseLock(dir, { pid: 4242, hostname: 'container-other' }).ok, true)
  assert.equal(fs.existsSync(file), false)
  clearLock(file) // 幂等:文件已不在也不抛
})
