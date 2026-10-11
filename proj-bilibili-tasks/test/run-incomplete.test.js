// R2/R3/R5/R6 的编排级验证:静默跳过必须被识别、读回校验不锁当天、投币报实际差值、大积分文案。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runOnce } from '../src/run.js'
import { loadState } from '../src/state.js'
import { NOW, REWARD_PARTIAL, makeDeps, setup } from './run-helpers.js'

// R2:Console 静默跳过必须被识别,不能算成功、不能锁当天
test('R2 guard-skipped:退出码 0 也不成功,不把当天标完成', async () => {
    const { config } = setup()
    const line = '[12:55:15 WRN] 异常:System.InvalidOperationException: 登录态检查暂时失败,本次活动已跳过,稍后自动重试'
    const deps = makeDeps({ runConsole: async () => ({ code: 0, stdout: line, stderr: '', timedOut: false }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.ok(result.messages[1].includes(' · 运行有失败'), result.messages[1])
    assert.ok(result.messages[1].includes('运行被上游跳过'), result.messages[1])
    const { state } = loadState(config.stateFile)
    assert.notEqual(state.lastResult, 'success')
    // 当天未完成 -> 下一次触发仍可重试(由 attempts 守卫封顶)
    const again = await runOnce({ config, deps, now: NOW })
    assert.notEqual(again.reason, 'done-today')
})

// R3:读回校验,share 未完成 -> 不锁当天
test('R3 分享未完成 -> 运行有失败且不锁当天', async () => {
    const { config } = setup()
    const deps = makeDeps({ fetchExpReward: async () => ({ ok: true, data: REWARD_PARTIAL }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.ok(result.messages[1].includes(' · 运行有失败'), result.messages[1])
    assert.ok(result.messages[1].includes('分享 未完成'), result.messages[1])
    const { state } = loadState(config.stateFile)
    assert.notEqual(state.lastResult, 'success')
})

test('R3 每日任务全完成 -> 正常锁当天', async () => {
    const { config } = setup()
    const deps = makeDeps()
    await runOnce({ config, deps, now: NOW })
    const { state } = loadState(config.stateFile)
    assert.equal(state.lastResult, 'success')
})

test('R3 exp 接口取不到 -> 不因它判未完成,按退出码判', async () => {
    const { config } = setup()
    const deps = makeDeps({ fetchExpReward: async () => ({ ok: false, error: 'HTTP 500' }) })
    await runOnce({ config, deps, now: NOW })
    const { state } = loadState(config.stateFile)
    assert.equal(state.lastResult, 'success')
})

// R5:投币报实际差值,或回落为明确的目标值
test('R5 差值为 0 -> 报 0 枚未投出', async () => {
    const { config } = setup()
    const deps = makeDeps({ fetchCoin: async () => ({ ok: true, data: { money: 128 } }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.ok(result.messages[1].includes('投币:0 枚 · 未投出 · 余额 128.0'), result.messages[1])
})

test('R5 取不到后值 -> 回落为目标值', async () => {
    const { config } = setup()
    let reads = 0
    const deps = makeDeps({ fetchCoin: async () => { reads += 1; return reads === 1 ? { ok: true, data: { money: 128 } } : { ok: false, error: '网络' } } })
    const result = await runOnce({ config, deps, now: NOW })
    assert.ok(result.messages[1].includes('投币:目标 ≤5 枚 · 投给关注的 UP · 余额 128.0'), result.messages[1])
})

test('R6 大积分失败不算整体失败,文案指向上游已知问题', async () => {
    const { config } = setup()
    const line = '[12:30:26 INF] 领取任务失败：{"Code":6007000,"Message":"请将客户端更新至最新版本"}'
    const deps = makeDeps({ runConsole: async () => ({ code: 0, stdout: line, stderr: '', timedOut: false }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.ok(result.messages[1].includes('大积分:日常领取失败 · 上游已知问题 · 不影响其它任务'), result.messages[1])
    assert.ok(result.messages[1].includes(' · 运行成功'), result.messages[1])
})
