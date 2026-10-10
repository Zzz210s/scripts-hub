import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runOnce } from '../src/run.js'
import { loadConfig } from '../src/config.js'
import { loadState } from '../src/state.js'

const NOW = new Date('2026-10-11T10:00:00')
const CRED = { cookie: 'cookie', mid: '123456', csrf: 'csrf' }
const ANNUAL = { code: 0, data: { isLogin: true, vipStatus: 1, vipType: 2, money: 128, wallet: { coupon_balance: 5 } } }

function setup(env = {}, state = null) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-run-'))
    const config = loadConfig({ BILIBILI_DIR: dir, ...env })
    if (state) {
        fs.mkdirSync(path.dirname(config.stateFile), { recursive: true })
        fs.writeFileSync(config.stateFile, JSON.stringify(state))
    }
    return { dir, config }
}

function makeDeps(overrides = {}) {
    const calls = { sent: [], fetch: [], spawn: [], lock: 0 }
    const base = {
        calls,
        log: () => {},
        readCookie: () => CRED,
        peerRunning: () => false,
        freeMb: () => 4096,
        fetchNav: async () => { calls.fetch.push('nav'); return { ok: true, data: ANNUAL } },
        fetchVoucher: async () => { calls.fetch.push('voucher'); return { ok: true, data: { code: 0, data: { list: [{ type: 1, state: 1, next_receive_days: 31 }] } } } },
        receiveVoucher: async () => { calls.fetch.push('receive'); return { ok: true } },
        fetchCoin: async () => { calls.fetch.push('coin'); return { ok: true, data: { money: 128 } } },
        fetchFollowingsTotal: async () => { calls.fetch.push('followings'); return { ok: true, total: 42 } },
        runConsole: async (tasks, env) => { calls.spawn.push({ tasks, env }); return { code: 0, stdout: '', stderr: '', timedOut: false } },
        send: async (text) => { calls.sent.push(text); return { ok: true } }
    }
    return { ...base, ...overrides, calls: overrides.calls ?? calls }
}

test('没有登录凭据 -> 静音跳过,零消息零网络', async () => {
    const { config } = setup()
    const deps = makeDeps({ readCookie: () => null })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.code, 0)
    assert.equal(result.reason, 'no-credentials')
    assert.deepEqual(result.messages, [])
    assert.deepEqual(deps.calls.fetch, [])
    assert.deepEqual(deps.calls.spawn, [])
})

test('当天已成功 -> done-today,零消息', async () => {
    const { config } = setup({}, { lastRunDay: '2026-10-11', lastResult: 'success', paused: false, days: {}, coinLedger: [], voucherHistory: [] })
    const deps = makeDeps()
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.code, 0)
    assert.equal(result.reason, 'done-today')
    assert.deepEqual(result.messages, [])
    assert.deepEqual(deps.calls.fetch, [])
})

test('正常一次:先 start 再 result,状态落 success', async () => {
    const { config } = setup()
    const deps = makeDeps()
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.code, 0)
    assert.equal(result.messages.length, 2)
    assert.ok(result.messages[0].includes(' · 开始运行'))
    assert.ok(result.messages[1].includes(' · 运行成功'))
    assert.ok(result.messages[1].includes('投币:5 枚 · 投给关注的 UP · 余额 128.0'))
    assert.ok(result.messages[1].includes('每日任务:登录 5 · 观看 5 · 分享 5 · 投币 50 · 共 65 经验'))
    assert.deepEqual(deps.calls.spawn[0].env.Ray_DailyTaskConfig__NumberOfCoins, '5')
    const { state } = loadState(config.stateFile)
    assert.equal(state.lastResult, 'success')
    assert.equal(state.lastRunDay, '2026-10-11')
    assert.equal(state.coinLedger.length, 1)
    assert.equal(state.voucherHistory.length, 1)
})

test('券今日已领过:并入 result,不单发消息', async () => {
    const { config } = setup()
    const deps = makeDeps()
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.messages.length, 2)
    assert.ok(result.messages[1].includes('会员券:B币券已领取 0 张 · 今日已领过'))
})

test('年度会员且状态可领 -> 领取并自证', async () => {
    const { config } = setup()
    let voucherCalls = 0
    const deps = makeDeps({
        fetchVoucher: async () => {
            voucherCalls += 1
            return voucherCalls === 1
                ? { ok: true, data: { code: 0, data: { list: [{ type: 1, state: 0, next_receive_days: 0 }] } } }
                : { ok: true, data: { code: 0, data: { list: [{ type: 1, state: 1, next_receive_days: 31 }] } } }
        }
    })
    const result = await runOnce({ config, deps, now: NOW })
    assert.ok(result.messages[1].includes('会员券:B币券已领取 1 张'))
    assert.equal(voucherCalls, 2)
    assert.ok(deps.calls.fetch.includes('receive'))
})

test('普通会员:静默跳过 B币券,不推 action', async () => {
    const { config } = setup()
    const monthly = { code: 0, data: { isLogin: true, vipStatus: 1, vipType: 1 } }
    const deps = makeDeps({ fetchNav: async () => ({ ok: true, data: monthly }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.messages.length, 2)
    assert.ok(result.messages[1].includes('会员券:普通会员 · 跳过 B币券'))
    assert.ok(!deps.calls.fetch.includes('voucher'))
})

test('登录态失效:只发一条 action,退出码非 0', async () => {
    const { config } = setup()
    const deps = makeDeps({ fetchNav: async () => ({ ok: true, data: { code: 0, data: { isLogin: false } } }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.code, 1)
    assert.equal(result.messages.length, 1)
    assert.ok(result.messages[0].includes(' · 需要你处理'))
    assert.ok(result.messages[0].includes('请你:在跑这个程序的机器上重新扫码登录一次'))
    assert.deepEqual(deps.calls.spawn, [])
})

test('-403 + 分享:result 用运行有失败并带缩进原因,不推 action', async () => {
    const { config } = setup()
    const deps = makeDeps({ runConsole: async () => ({ code: 1, stdout: '分享 -403 账号异常', stderr: '', timedOut: false }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.messages.length, 2)
    assert.ok(result.messages[1].includes(' · 运行有失败'))
    assert.ok(result.messages[1].includes('\n  原因:'))
    assert.ok(result.messages[1].includes('-403'))
})

test('关注列表为空 -> NumberOfCoins 置 0,投币行跳过', async () => {
    const { config } = setup()
    const deps = makeDeps({ fetchFollowingsTotal: async () => ({ ok: true, total: 0 }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(deps.calls.spawn[0].env.Ray_DailyTaskConfig__NumberOfCoins, '0')
    assert.ok(result.messages[1].includes('投币:跳过 · 关注列表为空'))
})

test('无法确认关注列表 -> 置 0', async () => {
    const { config } = setup()
    const deps = makeDeps({ fetchFollowingsTotal: async () => ({ ok: false, error: '网络' }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(deps.calls.spawn[0].env.Ray_DailyTaskConfig__NumberOfCoins, '0')
    assert.ok(result.messages[1].includes('投币:跳过 · 无法确认关注列表'))
})

test('余额不高于保留值 -> target 0,不报失败', async () => {
    const { config } = setup()
    const deps = makeDeps({ fetchCoin: async () => ({ ok: true, data: { money: 15 } }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.ok(result.messages[1].includes('投币:跳过 · 硬币余额不高于保留值 20'))
    assert.ok(result.messages[1].includes(' · 运行成功'))
})

test('取不到硬币余额 -> 跳过并标注', async () => {
    const { config } = setup()
    const deps = makeDeps({ fetchCoin: async () => ({ ok: false, error: '403' }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.ok(result.messages[1].includes('投币:跳过 · 未取到硬币余额'))
    assert.deepEqual(deps.calls.fetch.includes('followings'), false)
})

test('dry-run:零 fetch 零 spawn 不写状态', async () => {
    const { config } = setup({ BILIBILI_DRY_RUN: '1' })
    const deps = makeDeps()
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.dryRun, true)
    assert.equal(result.planned.length, 1)
    assert.deepEqual(deps.calls.fetch, [])
    assert.deepEqual(deps.calls.spawn, [])
    assert.equal(fs.existsSync(config.stateFile), false)
})

test('peer-running:拿不到锁就跳过', async () => {
    const { config } = setup()
    const deps = makeDeps({ acquireLock: () => ({ ok: false, holder: { pid: 1 } }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(result.reason, 'peer-running')
    assert.deepEqual(result.messages, [])
})
