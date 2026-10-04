// 本地状态:已领记录、当日尝试次数、去重、剪枝、原子写;坏文件回退空状态而不是抛。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emptyState, loadState, saveState, pendingGames, canAttempt, attemptsToday, recordAttempt, markGame, gameStatus, pruneState, notifiedOnce, markNotified, setPaused } from '../src/state.js'

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'epic-state-'))
const NOW = new Date('2026-10-06T01:00:00Z')
const GAME = { slug: 'system-shock-2', title: 'System Shock 2' }
const OTHER = { slug: 'tomb-star', title: 'Tomb Star' }

test('空状态形状固定', () => {
    const s = emptyState(NOW)
    assert.equal(s.version, 1)
    assert.equal(s.paused, false)
    assert.deepEqual(s.games, {})
    assert.deepEqual(s.days, {})
    assert.equal(s.updatedAt, NOW.toISOString())
})

test('已领 / 已在库的 slug 不再进入待领列表', () => {
    const s = emptyState(NOW)
    markGame(s, GAME, 'claimed', NOW)
    markGame(s, OTHER, 'existed', NOW)
    assert.deepEqual(pendingGames(s, [GAME, OTHER]), [])
    assert.equal(gameStatus(s, 'system-shock-2'), 'claimed')
})

test('失败的项下次仍待领;同一 slug 在清单里重复只算一次', () => {
    const s = emptyState(NOW)
    markGame(s, GAME, 'failed', NOW)
    const pending = pendingGames(s, [GAME, GAME, OTHER])
    assert.deepEqual(pending.map((g) => g.slug), ['system-shock-2', 'tomb-star'])
})

test('markGame 首次记录 firstSeenAt,终态记录 claimedAt', () => {
    const s = emptyState(NOW)
    markGame(s, GAME, 'failed', NOW)
    assert.equal(s.games['system-shock-2'].firstSeenAt, NOW.toISOString())
    assert.equal(s.games['system-shock-2'].claimedAt, null)
    const later = new Date('2026-10-06T02:00:00Z')
    markGame(s, GAME, 'claimed', later)
    assert.equal(s.games['system-shock-2'].firstSeenAt, NOW.toISOString())
    assert.equal(s.games['system-shock-2'].claimedAt, later.toISOString())
})

test('尝试次数按天累计,跨天归零;到上限后 canAttempt 为假', () => {
    const s = emptyState(NOW)
    assert.equal(attemptsToday(s, NOW), 0)
    assert.equal(canAttempt(s, NOW, 2), true)
    recordAttempt(s, NOW)
    recordAttempt(s, NOW)
    assert.equal(attemptsToday(s, NOW), 2)
    assert.equal(canAttempt(s, NOW, 2), false)
    assert.equal(canAttempt(s, new Date('2026-10-07T01:00:00Z'), 2), true)
})

test('剪枝丢掉过期的终态记录,保留没领到的', () => {
    const s = emptyState(NOW)
    markGame(s, GAME, 'claimed', new Date('2024-01-01T00:00:00Z'))
    markGame(s, OTHER, 'failed', new Date('2024-01-01T00:00:00Z'))
    pruneState(s, NOW, 400)
    assert.equal(gameStatus(s, 'system-shock-2'), null)
    assert.equal(gameStatus(s, 'tomb-star'), 'failed')
})

test('同因同日只通知一次', () => {
    const s = emptyState(NOW)
    assert.equal(notifiedOnce(s, 'nothing-new', NOW), false)
    markNotified(s, 'nothing-new', NOW)
    assert.equal(notifiedOnce(s, 'nothing-new', NOW), true)
    assert.equal(notifiedOnce(s, 'nothing-new', new Date('2026-10-07T01:00:00Z')), false)
})

test('原子写后重读一致;父目录会自动建', () => {
    const file = path.join(tmpdir(), 'nested', 'state.json')
    const s = emptyState(NOW)
    markGame(s, GAME, 'claimed', NOW)
    recordAttempt(s, NOW)
    saveState(file, s)
    const reloaded = loadState(file)
    assert.deepEqual(reloaded.warnings, [])
    assert.equal(gameStatus(reloaded.state, 'system-shock-2'), 'claimed')
    // 临时文件不残留
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['state.json'])
})

test('状态文件缺失 / 坏 JSON / 形状不对都回退空状态并给警告', () => {
    const missing = loadState(path.join(tmpdir(), 'nope.json'))
    assert.deepEqual(missing.warnings, [])
    assert.deepEqual(missing.state.games, {})

    const broken = path.join(tmpdir(), 'broken.json')
    fs.writeFileSync(broken, '{ not json')
    const bad = loadState(broken)
    assert.equal(bad.warnings.length, 1)
    assert.match(bad.warnings[0], /不是合法 JSON/)

    const wrong = path.join(tmpdir(), 'wrong.json')
    fs.writeFileSync(wrong, '[]')
    assert.equal(loadState(wrong).warnings.length, 1)
})

test('暂停位进状态,可开关', () => {
    const s = emptyState(NOW)
    setPaused(s, true, NOW)
    assert.equal(s.paused, true)
    setPaused(s, false, NOW)
    assert.equal(s.paused, false)
})
