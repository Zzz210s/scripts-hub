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
    // 投币目标默认改成 1 枚后,回落口径的投币经验是 10(1 枚 x 10)
    assert.ok(result.messages[1].includes('每日任务:登录 已得 5 · 观看 已得 5 · 分享 已得 5 · 投币 已得 10 · 共 25 经验 · 按计划口径估算'), result.messages[1])
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

// 回归:余额差值会被别处投币污染。2026-10-28 实测接口说「投币已得 10 经验」,
// 而余额差值算出 0 枚,消息写成「投币:0 枚 · 未投出」—— 与事实相反。
test('实际投币数取「接口经验」与「余额差值」的较大者', async () => {
    const { config } = setup()
    const deps = makeDeps({
        // 投币前 244.6,投币后仍是 244.6(差值为 0),但接口说今天投币已得 10 经验 = 1 枚
        fetchCoin: async () => ({ ok: true, data: { money: 244.6 } }),
        fetchExpReward: async () => ({ ok: true, data: { code: 0, data: { login: true, watch: true, share: true, coins: 10 } } })
    })
    const result = await runOnce({ config, deps, now: NOW })
    const text = result.messages.join(String.fromCharCode(10))
    assert.match(text, /投币:0 枚 · 未投出 · 今日累计 1 枚/, text)
})
