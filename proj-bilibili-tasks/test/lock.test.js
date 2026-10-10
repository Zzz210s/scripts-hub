import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readLock, writeLock, clearLock, acquireLock, peerRunning, defaultIsAlive } from '../src/lock.js'

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-lock-'))

test('锁文件形状与读写', () => {
    const file = path.join(tmpdir, 'run.lock')
    const lock = writeLock(file, new Date('2026-10-11T10:00:00'), 4242)
    assert.deepEqual(lock, { pid: 4242, startedAt: new Date('2026-10-11T10:00:00').toISOString() })
    assert.deepEqual(readLock(file), lock)
    clearLock(file)
    assert.equal(readLock(file), null)
})

test('活着的持有者 -> 拿不到;残锁 -> 可接管', () => {
    const file = path.join(tmpdir, 'a.lock')
    writeLock(file, new Date('2026-10-11T10:00:00'), 111)
    assert.equal(acquireLock(file, { isAlive: () => true }).ok, false)
    const stale = acquireLock(file, { now: new Date('2026-10-11T11:00:00'), isAlive: () => false, pid: 222 })
    assert.equal(stale.ok, true)
    assert.equal(stale.stale, true)
    assert.equal(readLock(file).pid, 222)
})

test('没有锁时直接拿到', () => {
    const file = path.join(tmpdir, 'b.lock')
    const result = acquireLock(file, { pid: 333 })
    assert.equal(result.ok, true)
    assert.equal(result.stale, false)
    assert.equal(readLock(file).pid, 333)
})

test('defaultIsAlive 对当前进程为真,对无效 pid 为假', () => {
    assert.equal(defaultIsAlive(process.pid), true)
    assert.equal(defaultIsAlive(0), false)
    assert.equal(defaultIsAlive(-1), false)
    assert.equal(defaultIsAlive('x'), false)
})

test('同伴锁按年龄判活:90 分钟内算在跑', () => {
    const now = new Date('2026-10-11T10:00:00')
    const fresh = path.join(tmpdir, 'fresh.lock')
    writeLock(fresh, new Date('2026-10-11T09:30:00'), 5)
    assert.equal(peerRunning([fresh], { now }), true)
    const old = path.join(tmpdir, 'old.lock')
    writeLock(old, new Date('2026-10-11T08:00:00'), 5)
    assert.equal(peerRunning([old], { now }), false)
    assert.equal(peerRunning([path.join(tmpdir, 'missing.lock')], { now }), false)
    assert.equal(peerRunning([], { now }), false)
})

test('没有 startedAt 的锁按 mtime 判活', () => {
    const file = path.join(tmpdir, 'plain.lock')
    fs.writeFileSync(file, 'not json')
    assert.equal(peerRunning([file], { now: new Date() }), true)
    assert.equal(peerRunning([file], { now: new Date(Date.now() + 2 * 3600 * 1000) }), false)
})
