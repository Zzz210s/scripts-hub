// 本地段守卫(纯函数):不联网就能判定这次不该跑。顺序与 docs/scheduling-convention.md 第 2 节一致。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quietHours, shutdownGuard, memorySkip, shouldSkipLocally, DEFAULT_LIMITS } from '../src/guards.js'

const at = (h, m = 0) => new Date(2026, 9, 6, h, m, 0)

test('安静时段按本机时刻判定', () => {
    assert.equal(quietHours(at(20, 0)), true)
    assert.equal(quietHours(at(22, 59)), true)
    assert.equal(quietHours(at(23, 0)), false)
    assert.equal(quietHours(at(19, 59)), false)
    assert.equal(quietHours(at(3, 0)), false)
    // 自定义跨零点的窗口
    assert.equal(quietHours(at(2, 0), '23:00', '06:00'), true)
    assert.equal(quietHours(at(12, 0), '23:00', '06:00'), false)
})

test('关机避让:距 02:00 不足默认 30 分钟就命中,且跨零点也算', () => {
    assert.equal(shutdownGuard(at(1, 45)), true)
    assert.equal(shutdownGuard(at(1, 25)), false)
    assert.equal(shutdownGuard(at(23, 50)), false)
    assert.equal(shutdownGuard(at(23, 45), '00:00', 30), true)
})

test('内存闸门两档', () => {
    assert.deepEqual(memorySkip(2000), { skip: false })
    assert.equal(memorySkip(500).skip, true)
    assert.equal(memorySkip(500).reason, 'low-memory')
    assert.equal(memorySkip(400, 300).skip, false)
})

test('shouldSkipLocally 按 暂停 > 尝试用尽 > 同伴 > 安静 > 关机 > 内存 的顺序给第一个原因', () => {
    const base = { now: at(10), paused: false, attempts: 0, maxAttempts: 2, freeMb: 2000, peerRunning: false }
    assert.equal(shouldSkipLocally(base).skip, false)
    assert.equal(shouldSkipLocally({ ...base, paused: true }).reason, 'paused')
    assert.equal(shouldSkipLocally({ ...base, attempts: 2 }).reason, 'already-attempted')
    assert.equal(shouldSkipLocally({ ...base, peerRunning: true }).reason, 'peer-running')
    assert.equal(shouldSkipLocally({ ...base, now: at(21) }).reason, 'quiet-hours')
    assert.equal(shouldSkipLocally({ ...base, now: at(1, 45) }).reason, 'shutdown-soon')
    assert.equal(shouldSkipLocally({ ...base, freeMb: 100 }).reason, 'low-memory')
    assert.equal(shouldSkipLocally({ ...base, freeMb: 100 }).detail, '100MB')
})

test('DEFAULT_LIMITS 是有名字的常量,便于文档引用', () => {
    assert.equal(typeof DEFAULT_LIMITS.minFreeMb, 'number')
    assert.match(DEFAULT_LIMITS.quietStart, /^\d{2}:\d{2}$/)
})
