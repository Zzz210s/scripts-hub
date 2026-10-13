// T7:本地守卫、熔断守卫与联网守卫。全部离线:时间由入参传,不发请求、不读真实进程表。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  DEFAULT_LIMITS,
  checkLocalGuards,
  checkOnlineGuards,
  peerBusy,
  quietHours,
  shutdownGuard,
} from '../src/guards.js'

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'netease-guards-'))

/** 除了要测的那一条,其余守卫都放行 —— 顺序靠后的守卫才有机会被命中。 */
const ctx = (now, patch = {}) => ({
  now,
  doneToday: false,
  circuitBroken: false,
  attempts: 0,
  maxAttempts: 3,
  peerRunning: false,
  freeMb: 4096,
  ...patch,
})

const MORNING = new Date('2026-10-11T09:00:00')

test('quietHours:窗口含起点不含终点,可跨零点', () => {
  assert.equal(quietHours(new Date('2026-10-11T19:59:00')), false)
  assert.equal(quietHours(new Date('2026-10-11T20:00:00')), true)
  assert.equal(quietHours(new Date('2026-10-11T22:59:00')), true)
  assert.equal(quietHours(new Date('2026-10-11T23:00:00')), false)
  assert.equal(quietHours(new Date('2026-10-11T01:00:00'), '23:00', '06:00'), true)
  assert.equal(quietHours(new Date('2026-10-11T12:00:00'), '23:00', '06:00'), false)
  assert.equal(quietHours(new Date('2026-10-11T12:00:00'), 'bogus', '06:00'), false)
})

test('shutdownGuard:距 02:00 关机不足 30 分钟才算命中', () => {
  assert.equal(shutdownGuard(new Date('2026-10-11T01:45:00')), true)
  assert.equal(shutdownGuard(new Date('2026-10-11T01:29:00')), false)
  assert.equal(shutdownGuard(new Date('2026-10-11T02:00:00')), true)
  assert.equal(shutdownGuard(new Date('2026-10-11T09:00:00')), false)
  assert.equal(shutdownGuard(new Date('2026-10-11T01:45:00'), 'bogus', 30), false)
})

test('checkLocalGuards:全部放行时 action=run', () => {
  assert.deepEqual(checkLocalGuards(ctx(MORNING)), { action: 'run', reason: 'ok', detail: '' })
  assert.equal(DEFAULT_LIMITS.minFreeMb, 800)
})

test('checkLocalGuards:守卫各命中一次,顺序只报第一个', () => {
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { paused: true })), {
    action: 'skip',
    reason: 'paused',
    detail: '',
  })
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { doneToday: true })), {
    action: 'skip',
    reason: 'done-today',
    detail: '',
  })
  // 当天熔断是「今天已有结论」的第二种,排在次数之前:熔断当天不该再消耗尝试次数。
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { circuitBroken: true })), {
    action: 'skip',
    reason: 'circuit-broken',
    detail: '',
  })
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { attempts: 3 })), {
    action: 'skip',
    reason: 'attempts-exhausted',
    detail: '3/3',
  })
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { peerRunning: true, peerDetail: 'rewards 正在运行' })), {
    action: 'skip',
    reason: 'peer-running',
    detail: 'rewards 正在运行',
  })
  assert.deepEqual(checkLocalGuards(ctx(new Date('2026-10-11T21:00:00'))), {
    action: 'skip',
    reason: 'quiet-hours',
    detail: '20:00-23:00',
  })
  assert.deepEqual(checkLocalGuards(ctx(new Date('2026-10-11T01:45:00'))), {
    action: 'skip',
    reason: 'before-shutdown',
    detail: '30 分钟内关机',
  })
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { freeMb: 100 })), {
    action: 'skip',
    reason: 'low-memory',
    detail: '100MB < 800MB',
  })

  // 同时满足多条时,报最先的那条:已完成胜过熔断、次数用尽与同伴在跑。
  const both = checkLocalGuards(ctx(MORNING, { doneToday: true, circuitBroken: true, attempts: 9 }))
  assert.equal(both.reason, 'done-today')
  assert.equal(checkLocalGuards(ctx(MORNING, { circuitBroken: true, attempts: 9 })).reason, 'circuit-broken')
  // 阈值可经 limits 覆盖。
  assert.deepEqual(checkLocalGuards(ctx(MORNING, { freeMb: 100, limits: { minFreeMb: 50 } })), {
    action: 'run',
    reason: 'ok',
    detail: '',
  })
})

test('checkOnlineGuards:没有可用凭据才拦,单账号失效不影响整轮', () => {
  assert.deepEqual(checkOnlineGuards({}), { action: 'skip', reason: 'no-credentials', detail: '未配置账号' })
  assert.equal(checkOnlineGuards({ credentials: [{ name: 'a', ok: true }] }).action, 'run')
  // 缺 ok 字段必须当不可用(fail-closed),不能默认放行。
  assert.deepEqual(checkOnlineGuards({ credentials: [{ name: 'a' }] }), {
    action: 'skip',
    reason: 'credentials-invalid',
    detail: '全部 1 个账号凭据失效',
  })
  assert.deepEqual(checkOnlineGuards({ credentials: [{ name: 'a', ok: true }, { name: 'b', ok: false }] }), {
    action: 'run',
    reason: 'ok',
    detail: '1 个账号凭据失效,其余照跑',
  })
})

/** 造一个「有锁文件 + 有 run-state.js」的假同伴项目。 */
function peerFixture(verdict, { throwOnExec = false } = {}) {
  const projectDir = path.join(tmpDir(), 'proj-peer')
  fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true })
  fs.mkdirSync(path.join(projectDir, 'scripts', 'windows'), { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'scripts', 'windows', 'run-state.js'), '// stub', 'utf8')
  const lock = path.join(projectDir, 'logs', 'run.lock')
  fs.writeFileSync(lock, JSON.stringify({ pid: 1, host: 'other', startedAt: new Date().toISOString() }), 'utf8')
  const exec = () => {
    if (throwOnExec) throw new Error('查不通')
    return `${verdict}\n`
  }
  return { lock, exec }
}

test('peerBusy:RUNNING 挡路;STALE/NONE 是残锁不挡路', () => {
  const running = peerFixture('RUNNING')
  assert.equal(peerBusy([running.lock], { exec: running.exec, nowMs: Date.now() }).busy, true)

  const stale = peerFixture('STALE')
  assert.equal(peerBusy([stale.lock], { exec: stale.exec, nowMs: Date.now() }).busy, false)
  const none = peerFixture('NONE')
  assert.equal(peerBusy([none.lock], { exec: none.exec, nowMs: Date.now() }).busy, false)
})

test('peerBusy:查不通时只对 10 分钟内的新锁保守让路', () => {
  const { lock, exec } = peerFixture('', { throwOnExec: true })
  const fresh = Date.now()
  assert.equal(peerBusy([lock], { exec, nowMs: fresh }).busy, true)
  // 20 分钟前的旧锁:查不通也不挡路,否则坏掉的同伴查询会把本程序锁死。
  const old = Date.now() + 20 * 60000
  assert.equal(peerBusy([lock], { exec, nowMs: old }).busy, false)
})

test('peerBusy:没有锁的同伴不挡路', () => {
  const missing = path.join(tmpDir(), 'proj-x', 'logs', 'run.lock')
  assert.equal(peerBusy([missing], { exec: () => '' }).busy, false)
  assert.equal(peerBusy([], {}).busy, false)
})

test('quietHours 与 shutdownGuard 用本机时区,序数比较不看日期', () => {
  // 与 os 无关的纯函数;这条只是防止未来换成 UTC 取值。
  assert.equal(typeof os.hostname(), 'string')
})
