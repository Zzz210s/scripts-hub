// 编排:探测 -> 判定 -> 通知 -> 引擎 -> 归类 -> 通知 -> 落状态。全部外部动作可注入,测试离线。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runOnce } from '../src/run.js'
import { loadState, saveState, emptyState, recordAttempt, saveState as writeState, gameStatus } from '../src/state.js'

const NOW = new Date(2026, 9, 6, 10, 0, 0)
const GAME = { slug: 'tomb-star', title: 'Tomb Star', offerId: 'oid', namespace: 'ns', url: 'https://store.epicgames.com/en-US/p/tomb-star' }

function setup(over = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-run-'))
    const config = {
        root: dir,
        stateFile: path.join(dir, 'data', 'state.json'),
        webhookFile: path.join(dir, 'secrets', 'wecom-webhook.txt'),
        maxAttemptsPerDay: 2,
        dryRun: false
    }
    const calls = { probe: 0, engine: 0, sent: [] }
    const deps = {
        probe: async () => { calls.probe++; return { ok: true, current: [GAME], upcoming: [] } },
        runEngine: async () => { calls.engine++; return { code: 0, stdout: 'Claimed successfully!' } },
        readDb: () => ({ TestUser: { 'tomb-star': { status: 'claimed' } } }),
        send: async (text) => { calls.sent.push(text); return { ok: true } },
        freeMb: () => 2000,
        peerRunning: () => false,
        ...over
    }
    return { dir, config, deps, calls }
}

test('当期没有未领的项:不启动引擎、不发消息、退出码 0', async () => {
    const { config, deps, calls } = setup({ probe: async () => { calls.probe++; return { ok: true, current: [GAME], upcoming: [] } } })
    // 先把这款标成已领
    const state = emptyState(NOW)
    state.games['tomb-star'] = { title: 'Tomb Star', status: 'claimed', firstSeenAt: NOW.toISOString(), claimedAt: NOW.toISOString() }
    writeState(config.stateFile, state)
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.code, 0)
    assert.deepEqual(calls.sent, [])
    assert.equal(calls.engine, 0)
})

test('有新限免:先发 start 再跑引擎,成功后发 result 并把状态标成已领', async () => {
    const { config, deps, calls } = setup()
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.code, 0)
    assert.equal(calls.probe, 1)
    assert.equal(calls.engine, 1)
    assert.equal(calls.sent.length, 2)
    assert.match(calls.sent[0], /开始领取/)
    assert.match(calls.sent[1], /运行成功/)
    assert.match(calls.sent[1], /已领取 Tomb Star/)
    assert.equal(gameStatus(loadState(config.stateFile).state, 'tomb-star'), 'claimed')
})

test('跑过之后同一款不再重复领取', async () => {
    const { config, deps, calls } = setup()
    await runOnce({ config, deps, now: NOW })
    const again = await runOnce({ config, deps, now: NOW })
    assert.equal(again.skipped, 'nothing-new')
    assert.equal(calls.engine, 1)
})

test('hCaptcha:发需要你处理并带结账链接,状态保持失败,退出码非 0', async () => {
    const { config, deps, calls } = setup({
        runEngine: async () => { calls.engine++; return { code: 1, stdout: '  Got hcaptcha challenge! Lost trust' } },
        readDb: () => ({})
    })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.code, 1)
    assert.equal(calls.sent.length, 2)
    assert.match(calls.sent[1], /需要你处理/)
    assert.match(calls.sent[1], /结账链接:https:\/\/www\.epicgames\.com\/store\/purchase\?offers=1-ns-oid/)
    assert.equal(gameStatus(loadState(config.stateFile).state, 'tomb-star'), 'failed')
})

test('登录态失效:发需要你处理且不给结账链接', async () => {
    const { config, deps, calls } = setup({
        runEngine: async () => { calls.engine++; return { code: 1, stdout: 'Not signed in anymore. Please login in the browser' } },
        readDb: () => ({})
    })
    await runOnce({ config, deps, now: NOW })
    assert.match(calls.sent[1], /登录令牌已失效/)
    assert.doesNotMatch(calls.sent[1], /结账链接/)
})

test('尝试次数用尽:静音跳过,不启动引擎', async () => {
    const { config, deps, calls } = setup()
    const state = emptyState(NOW)
    recordAttempt(state, NOW)
    recordAttempt(state, NOW)
    writeState(config.stateFile, state)
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.skipped, 'already-attempted')
    assert.equal(calls.engine, 0)
    assert.deepEqual(calls.sent, [])
})

test('暂停与低内存:前者照旧推一条,后者也推;安静时段静音', async () => {
    const paused = setup()
    const pausedState = emptyState(NOW)
    pausedState.paused = true
    writeState(paused.config.stateFile, pausedState)
    await runOnce({ config: paused.config, deps: paused.deps, now: NOW })
    assert.match(paused.calls.sent[0], /正常跳过/)
    assert.match(paused.calls.sent[0], /已手动暂停/)

    const lowMem = setup({ freeMb: () => 100 })
    await runOnce({ config: lowMem.config, deps: lowMem.deps, now: NOW })
    assert.match(lowMem.calls.sent[0], /可用内存不足/)

    const quiet = setup()
    await runOnce({ config: quiet.config, deps: quiet.deps, now: new Date(2026, 9, 6, 21, 0, 0) })
    assert.deepEqual(quiet.calls.sent, [])
})

test('读免费清单失败:推一条跳过,不启动引擎,退出码非 0', async () => {
    const { config, deps, calls } = setup({ probe: async () => { calls.probe++; return { ok: false, error: 'HTTP 503' } } })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.code, 1)
    assert.equal(calls.engine, 0)
    assert.match(calls.sent[0], /读免费游戏清单失败/)
})

test('dry-run:探测与引擎都不跑,只报告会发什么', async () => {
    const { config, deps, calls } = setup()
    const result = await runOnce({ config: { ...config, dryRun: true }, deps, now: NOW })
    assert.equal(calls.probe, 0)
    assert.equal(calls.engine, 0)
    assert.deepEqual(calls.sent, [])
    assert.ok(result.planned.some((text) => /开始领取/.test(text)))
})

test('状态文件不存在也能跑(首次运行)', async () => {
    const { config, deps } = setup()
    assert.equal(fs.existsSync(config.stateFile), false)
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.code, 0)
    assert.equal(loadState(config.stateFile).warnings.length, 0)
})

test('状态可注入以便复用(不落盘也能算)', async () => {
    const { config, deps } = setup()
    const state = emptyState(NOW)
    saveState(config.stateFile, state)
    await runOnce({ config, deps, now: NOW })
    assert.equal(loadState(config.stateFile).state.account, 'TestUser')
})

test('登录令牌被吊销:发需要你处理的登录提示,不启动引擎', async () => {
    const { config, deps, calls } = setup({ ensureSession: async () => ({ ok: false, needsLogin: true, error: 'refresh_token 已失效' }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.code, 1)
    assert.equal(calls.engine, 0)
    assert.equal(calls.sent.length, 1)
    assert.match(calls.sent[0], /需要你处理/)
    assert.match(calls.sent[0], /node src\/cli\.js login/)
})

test('续期网络失败:发可重试的提示,不启动引擎也不给结账链接', async () => {
    const { config, deps, calls } = setup({ ensureSession: async () => ({ ok: false, network: true, error: 'HTTP 503' }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.code, 1)
    assert.equal(calls.engine, 0)
    assert.match(calls.sent[0], /下一次触发时自动重试/)
    assert.doesNotMatch(calls.sent[0], /结账链接/)
})

test('会话就绪:注入成功后照常发 start 并跑引擎', async () => {
    let called = 0
    const { config, deps, calls } = setup({ ensureSession: async () => { called++; return { ok: true, mode: 'refreshed', injected: true } } })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.code, 0)
    assert.equal(called, 1)
    assert.equal(calls.engine, 1)
    assert.match(calls.sent[0], /开始领取/)
})
