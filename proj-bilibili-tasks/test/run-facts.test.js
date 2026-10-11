import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runOnce } from '../src/run.js'
import { NOW, makeDeps, setup } from './run-helpers.js'

test('券余额用领取后重新取的 nav 值,并带有效期', async () => {
    const { config } = setup()
    let navCalls = 0
    let voucherCalls = 0
    const deps = makeDeps({
        fetchNav: async () => {
            navCalls += 1
            return { ok: true, data: { code: 0, data: { isLogin: true, vipStatus: 1, vipType: 2, wallet: { coupon_balance: navCalls === 1 ? 0 : 5 } } } }
        },
        fetchVoucher: async () => {
            voucherCalls += 1
            const list = [{ type: 1, state: voucherCalls === 1 ? 0 : 1, next_receive_days: 16, expire_time: 1794326400 }]
            return { ok: true, data: { code: 0, data: { list } } }
        }
    })
    const result = await runOnce({ config, deps, now: NOW })
    assert.equal(navCalls, 2)
    assert.ok(result.messages[1].includes('会员券:B币券已领取 1 张 · 余额 5 · 有效至 2026-11-11 · 下次可领 16 天后'), result.messages[1])
})

test('exp/reward 取不到 -> 回落估算并明确标注', async () => {
    const { config } = setup()
    const deps = makeDeps({ fetchExpReward: async () => ({ ok: false, error: 'HTTP 500' }) })
    const result = await runOnce({ config, deps, now: NOW })
    assert.ok(result.messages[1].includes('每日任务:登录 已得 5 · 观看 已得 5 · 分享 已得 5 · 投币 已得 50 · 共 65 经验 · 按计划口径估算'), result.messages[1])
})

test('失败原因行不出现裸日志与圆括号', async () => {
    const { config } = setup()
    const line = '[12:30:26 INF] 领取任务失败：{"Code":6007000,"Message":"请将客户端更新至最新版本"}'
    const deps = makeDeps({ runConsole: async () => ({ code: 0, stdout: line, stderr: '', timedOut: false }) })
    const result = await runOnce({ config, deps, now: NOW })
    const detail = result.messages[1].split('\n').find((row) => row.includes('原因:'))
    assert.ok(detail.includes('6007000'), detail)
    assert.ok(!detail.includes('INF') && !detail.includes('{'), detail)
    assert.ok(!/[()（）]/.test(result.messages[1]), result.messages[1])
})
