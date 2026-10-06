// 单实例锁与同伴互查:残锁按进程实况回收,过期的同伴锁不算数。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { lockFile, lockStatus, writeLock, clearLock, peerRunning } from '../src/lock.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'epic-lock-'))

test('没有锁文件是 NONE', () => {
    assert.equal(lockStatus(path.join(tmp(), 'run.lock')), 'NONE')
})

test('有活进程是 RUNNING,进程已死是 STALE 且残锁被删掉', () => {
    const file = path.join(tmp(), 'run.lock')
    writeLock(file)
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))).sort(), ['pid', 'startedAt'])
    assert.equal(lockStatus(file, () => true), 'RUNNING')
    assert.equal(lockStatus(file, () => false), 'STALE')
    assert.equal(fs.existsSync(file), false)
})

test('clearLock 幂等', () => {
    const file = path.join(tmp(), 'run.lock')
    writeLock(file)
    clearLock(file)
    clearLock(file)
    assert.equal(fs.existsSync(file), false)
})

test('同伴互查:新写的锁算在跑;过期的与不存在的都不算', () => {
    const dir = tmp()
    const fresh = path.join(dir, 'weread.lock')
    writeLock(fresh)
    assert.equal(peerRunning([fresh]), true)
    assert.equal(peerRunning([path.join(dir, 'nope.lock')]), false)
    assert.equal(peerRunning([], {}), false)

    const old = path.join(dir, 'old.lock')
    fs.writeFileSync(old, JSON.stringify({ pid: 999999, startedAt: '2020-01-01T00:00:00.000Z' }))
    assert.equal(peerRunning([old], { now: new Date('2026-10-06T00:00:00Z') }), false)
    assert.equal(peerRunning([path.join(dir, 'garbage.lock')]), false)

    const broken = path.join(dir, 'broken.lock')
    fs.writeFileSync(broken, 'not json')
    assert.equal(peerRunning([broken]), false)
})

test('lockFile 落在 logs/ 下', () => {
    assert.match(lockFile('/tmp/x'), /logs[\\/]run\.lock$/)
})
