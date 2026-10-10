import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldSkipLocally, quietHours, shutdownGuard, memorySkip, DEFAULT_LIMITS } from '../src/guards.js'

const NOW = new Date('2026-10-11T10:00:00')

test('七个守卫各命中一次', () => {
    assert.equal(shouldSkipLocally({ now: NOW, paused: true }).reason, 'paused')
    assert.equal(shouldSkipLocally({ now: NOW, lastRunDay: '2026-10-11', lastResult: 'success' }).reason, 'done-today')
    assert.equal(shouldSkipLocally({ now: NOW, attempts: 2, maxAttempts: 2 }).reason, 'attempts-exhausted')
    assert.equal(shouldSkipLocally({ now: NOW, peerRunning: true }).reason, 'peer-running')
    assert.equal(shouldSkipLocally({ now: NOW, limits: { quietStart: '09:00', quietEnd: '11:00' } }).reason, 'quiet-hours')
    assert.equal(shouldSkipLocally({ now: new Date('2026-10-11T01:45:00') }).reason, 'before-shutdown')
    assert.equal(shouldSkipLocally({ now: NOW, freeMb: 100 }).reason, 'low-memory')
    assert.equal(shouldSkipLocally({ now: NOW }).skip, false)
})

test('顺序固定:只报第一个命中的原因', () => {
    assert.equal(shouldSkipLocally({ now: NOW, paused: true, lastRunDay: '2026-10-11', lastResult: 'success', attempts: 9, peerRunning: true, freeMb: 1 }).reason, 'paused')
    assert.equal(shouldSkipLocally({ now: NOW, lastRunDay: '2026-10-11', lastResult: 'success', attempts: 9, peerRunning: true }).reason, 'done-today')
    assert.equal(shouldSkipLocally({ now: NOW, attempts: 9, peerRunning: true }).reason, 'attempts-exhausted')
    assert.equal(shouldSkipLocally({ now: NOW, peerRunning: true, freeMb: 1 }).reason, 'peer-running')
})

test('done-today 只在同日且成功时命中', () => {
    assert.equal(shouldSkipLocally({ now: NOW, lastRunDay: '2026-10-11', lastResult: 'failure' }).skip, false)
    assert.equal(shouldSkipLocally({ now: NOW, lastRunDay: '2026-10-10', lastResult: 'success' }).skip, false)
})

test('阈值:安静 20:00-23:00 / 02:00 前 30 分钟 / 800MB', () => {
    assert.equal(shouldSkipLocally({ now: new Date('2026-10-11T20:00:00') }).reason, 'quiet-hours')
    assert.equal(shouldSkipLocally({ now: new Date('2026-10-11T19:59:00') }).skip, false)
    assert.equal(shouldSkipLocally({ now: new Date('2026-10-11T01:29:00') }).skip, false)
    assert.equal(shouldSkipLocally({ now: new Date('2026-10-11T01:30:00') }).skip, false)
    assert.equal(shouldSkipLocally({ now: new Date('2026-10-11T01:31:00') }).reason, 'before-shutdown')
    assert.equal(shouldSkipLocally({ now: NOW, freeMb: 799 }).reason, 'low-memory')
    assert.equal(shouldSkipLocally({ now: NOW, freeMb: 800 }).skip, false)
    assert.equal(DEFAULT_LIMITS.minFreeMb, 800)
})

test('quietHours 支持跨零点;shutdownGuard/memorySkip 边界', () => {
    assert.equal(quietHours(new Date('2026-10-11T23:30:00'), '22:00', '06:00'), true)
    assert.equal(quietHours(new Date('2026-10-11T12:00:00'), '22:00', '06:00'), false)
    assert.equal(quietHours(NOW, 'bad', '06:00'), false)
    assert.equal(shutdownGuard(new Date('2026-10-11T01:45:00')), true)
    assert.equal(shutdownGuard(NOW), false)
    assert.deepEqual(memorySkip(100), { skip: true, reason: 'low-memory', detail: '100MB' })
    assert.deepEqual(memorySkip(900), { skip: false })
})
