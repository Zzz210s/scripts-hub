import assert from 'node:assert/strict'
import test from 'node:test'

import { decideLocal, decideRemote, inQuietHours, minutesToShutdown, parseClock } from '../src/guards.js'

const config = {
    quietStart: '20:00',
    quietEnd: '23:00',
    shutdownTime: '02:00',
    shutdownGuardMinutes: 30,
    maxAttemptsPerDay: 3
}
const okStats = { ok: true, todaySeconds: 0 }
const idleState = { todayMinutes: 0, targetMinutes: 66, attempts: 0, done: false }

test('parseClock 解析时刻并拒绝非法值', () => {
    assert.equal(parseClock('20:00'), 1200)
    assert.equal(parseClock('2:5'), null)
    assert.equal(parseClock('25:00'), null)
    assert.equal(parseClock(''), null)
})

test('安静时段含边界,支持跨午夜', () => {
    assert.equal(inQuietHours(new Date('2026-10-01T20:00:00'), '20:00', '23:00'), true)
    assert.equal(inQuietHours(new Date('2026-10-01T19:59:00'), '20:00', '23:00'), false)
    assert.equal(inQuietHours(new Date('2026-10-01T23:00:00'), '20:00', '23:00'), false)
    assert.equal(inQuietHours(new Date('2026-10-02T01:00:00'), '22:00', '07:00'), true)
    assert.equal(inQuietHours(new Date('2026-10-02T12:00:00'), '22:00', '07:00'), false)
})

test('距关机时间跨午夜也算得对', () => {
    assert.equal(minutesToShutdown(new Date('2026-10-01T01:00:00'), '02:00'), 60)
    assert.equal(minutesToShutdown(new Date('2026-10-01T23:30:00'), '02:00'), 150)
})

test('今天已达标 -> done', () => {
    const verdict = decideAll({ now: new Date('2026-10-01T10:00:00'), config, state: { ...idleState, done: true, todayMinutes: 70 }, stats: okStats })
    assert.equal(verdict.run, false)
    assert.equal(verdict.reason, 'done')
})

test('安静时段 -> quiet-hours,force 可跳过', () => {
    const input = { now: new Date('2026-10-01T21:00:00'), config, state: idleState, stats: okStats }
    assert.equal(decideAll(input).reason, 'quiet-hours')
    assert.equal(decideAll({ ...input, force: true }).run, true)
})

test('距关机不足 30 分钟 -> before-shutdown', () => {
    const verdict = decideAll({ now: new Date('2026-10-01T01:45:00'), config, state: idleState, stats: okStats })
    assert.equal(verdict.reason, 'before-shutdown')
})

test('尝试次数用尽与统计不可用都会退出', () => {
    assert.equal(decideAll({ now: new Date('2026-10-01T10:00:00'), config, state: { ...idleState, attempts: 3 }, stats: okStats }).reason, 'attempts-exhausted')
    assert.equal(decideAll({ now: new Date('2026-10-01T10:00:00'), config, state: idleState, stats: { ok: false, error: '超时' } }).reason, 'stats-unavailable')
})

test('手动暂停优先于其它条件', () => {
    const verdict = decideAll({ now: new Date('2026-10-01T10:00:00'), config, state: idleState, stats: okStats, paused: true })
    assert.equal(verdict.reason, 'paused')
})

test('全部通过时可运行', () => {
    const verdict = decideAll({ now: new Date('2026-10-01T10:00:00'), config, state: idleState, stats: okStats })
    assert.equal(verdict.run, true)
    assert.equal(verdict.reason, 'ok')
})

test('同伴程序在跑 -> peer-running', () => {
    const verdict = decideAll({ now: new Date('2026-10-01T10:00:00'), config, state: idleState, stats: okStats, peerBusy: true, peerDetail: 'Microsoft-Rewards-Script-4.3.2 正在运行' })
    assert.equal(verdict.run, false)
    assert.equal(verdict.reason, 'peer-running')
    assert.match(verdict.detail, /Microsoft-Rewards-Script-4.3.2/)
})

/** 测试适配器:按新的两段式守卫跑一遍,语义与旧的单函数调用一致。 */
function decideAll(input) {
    const local = decideLocal(input)
    if (!local.run) return local
    return decideRemote(input)
}

test('联网守卫:凭据失效与统计读不到分别报出原因', () => {
    assert.equal(decideRemote({ credential: false, credentialDetail: 'HTTP 401', stats: { ok: true } }).reason, 'credential-invalid')
    assert.equal(decideRemote({ credential: true, stats: { ok: false, error: '超时' } }).reason, 'stats-unavailable')
    assert.equal(decideRemote({ credential: true, stats: { ok: true } }).run, true)
    // 今天已读够(本次会话 0 分钟)时按 done 退出,不再多跑一轮
    const done = decideRemote({ credential: true, stats: { ok: true }, plan: { runMinutes: 0, todayMinutes: 110 } })
    assert.equal(done.run, false)
    assert.equal(done.reason, 'done')
    assert.match(done.detail, /110 分钟/)
})

test('本地守卫不碰网络:同伴在跑、已达标、安静时段都能独立判定', () => {
    const base = { now: new Date('2026-10-02T10:00:00'), config, state: idleState, paused: false, force: false }
    assert.equal(decideLocal({ ...base, peerBusy: true, peerDetail: 'x 正在运行(已 44 分钟)' }).reason, 'peer-running')
    assert.equal(decideLocal({ ...base, state: { ...idleState, done: true, todayMinutes: 70 } }).reason, 'done')
    assert.equal(decideLocal({ ...base, now: new Date('2026-10-02T21:00:00') }).reason, 'quiet-hours')
    assert.equal(decideLocal(base).run, true)
})
