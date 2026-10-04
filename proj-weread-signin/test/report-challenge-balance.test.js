// 日报里挑战进度(接口口径)与书币余额的渲染:有接口用接口,读不到回落累计口径。
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildReport } from '../src/notify.js'
import { challengeRecord } from '../src/rewards-coins.js'

const BASE = {
    plan: { todayMinutes: 40, targetMinutes: 66, minutesSoFar: 300, remainingDays: 25, failableDays: 3, timeSlack: 9, daySlack: 3, validDaysSoFar: 5, validNeeded: 24, emergency: false },
    run: { ok: true, reportedSeconds: 2400, requests: 5, outcome: '成功' },
    config: { requiredMinutes: 1800, requiredValidDays: 29, windowAssumed: false },
    date: '2026-10-03',
    accountName: 'TestReader'
}

const PAID = { id: 'readchallenge4', isPaid: true, totalDays: 30, readSeconds: 9360, readDays: 2, targetDays: 29, targetSeconds: 108000, remainDays: 28, canMiss: 1, rewardCoin: 30, rewardCard: 30, extraRewardCoin: 10, extraRewardCard: 5 }
const FREE = { id: 'ChallengeLongTermFree', isPaid: false, totalDays: 21, readSeconds: 9360, readDays: 2, targetDays: 21, targetSeconds: 36000, remainDays: 19, canMiss: 0, rewardCoin: 0 }

test('日报:有接口数据时每条挑战一行且都顶格,福利行带体验卡', () => {
    const text = buildReport({
        ...BASE,
        challenge: { ok: true, list: [PAID, FREE] },
        balance: { ok: true, balance: 16.6, giftBalance: 16.6, expiryBalance: 0 },
        memberCard: { ok: true, freeCardDays: 3, remainDays: 3, isPaying: true },
        weeklyStatus: { tiers: { total: 8, claimed: 5, unreached: 3, claimable: 0 } }
    })
    assert.match(text, /挑战:付费 30 天 · 2\.6 \/ 30\.0 小时 · 已读 2\/29 天 · 剩 28 天 · 还可漏 1 天\n/)
    assert.match(text, /\n免费 21 天 · 2\.6 \/ 10\.0 小时 · 已读 2\/21 天 · 剩 19 天 · 不能再漏天数/)
    assert.doesNotMatch(text, /\n +免费/)          // 第二条挑战顶格,不缩进
    assert.doesNotMatch(text, /奖 0 书币/)
    assert.doesNotMatch(text, /挑战:累计/)
    assert.match(text, /福利:书币余额 16\.60 · 即将过期 0\.00 · 体验卡 3 天/)
    assert.doesNotMatch(text, /[()]/)
})

test('日报:挑战行不再显示达标奖/超额奖明细', () => {
    const text = buildReport({ ...BASE, challenge: { ok: true, list: [PAID] } })
    assert.doesNotMatch(text, /达标奖/)
    assert.doesNotMatch(text, /超额奖/)
    assert.doesNotMatch(text, /体验卡/)
    assert.match(text, /付费 30 天/)
})

test('日报:没有接口数据时挑战行回落为累计口径,并保留默认日期提醒', () => {
    const text = buildReport({
        ...BASE,
        config: { ...BASE.config, windowAssumed: true },
        challenge: { ok: false, reason: 'query-failed', list: [] }
    })
    assert.match(text, /挑战:累计 5\.0 \/ 30\.0 小时 · 剩 25 天 · 有效 5\/29 · 还可漏 3 天/)
    assert.match(text, /提醒:挑战起止日期用的是默认值,请核对/)
    assert.doesNotMatch(text, /[()]/)
})

test('日报:接口成功但没有进行中的挑战时不回落(避免报出不存在的挑战)', () => {
    const text = buildReport({ ...BASE, challenge: { ok: true, list: [] } })
    assert.match(text, /挑战:无进行中的挑战/)
    assert.doesNotMatch(text, /累计/)
})

test('日报:接口不可用时才回落到累计口径', () => {
    const text = buildReport({ ...BASE, challenge: { ok: false, reason: 'query-failed', list: [] } })
    assert.match(text, /挑战:累计 5\.0 \/ 30\.0 小时 · 剩 25 天 · 有效 5\/29 · 还可漏 3 天/)
})

test('日报:余额读不到时福利行不含书币余额与即将过期', () => {
    const noBalance = buildReport({ ...BASE, welfare: { claimed: false, coin: 0, reason: 'no-coin' } })
    assert.doesNotMatch(noBalance, /书币余额/)
    assert.doesNotMatch(noBalance, /即将过期/)
    assert.match(noBalance, /福利:/)
    const failedBalance = buildReport({
        ...BASE,
        welfare: { claimed: false, coin: 0, reason: 'no-coin' },
        balance: { ok: false, reason: 'query-failed', balance: 0, giftBalance: 0, expiryBalance: 0 }
    })
    assert.doesNotMatch(failedBalance, /书币余额/)
    assert.doesNotMatch(failedBalance, /即将过期/)
})

test('日报:即将过期书币随余额一起显示', () => {
    const text = buildReport({ ...BASE, balance: { ok: true, balance: 16.6, giftBalance: 16.6, expiryBalance: 2.5 } })
    assert.match(text, /福利:书币余额 16\.60 · 即将过期 2\.50/)
})

test('日报:只有体验卡没有书币余额时福利行也显示体验卡', () => {
    const text = buildReport({ ...BASE, memberCard: { ok: true, freeCardDays: 5, remainDays: 5 } })
    assert.match(text, /福利:体验卡 5 天/)
    assert.doesNotMatch(text, /书币余额/)
})

test('日报:体验卡读不到时不显示体验卡', () => {
    const text = buildReport({ ...BASE, memberCard: { ok: false, reason: 'query-failed', freeCardDays: 0, remainDays: 0 } })
    assert.doesNotMatch(text, /体验卡/)
})

test('历史落盘的挑战形状喂给日报时不出现 undefined', () => {
    const recorded = challengeRecord({ ok: true, list: [PAID] })
    const text = buildReport({ ...BASE, run: null, challenge: recorded })
    assert.doesNotMatch(text, /undefined/)
    assert.match(text, /付费 30 天/)
    assert.doesNotMatch(text, /达标奖/)
})

test('接口正常但没有进行中的挑战时,不回落成估算口径', () => {
    const text = buildReport({ ...BASE, run: null, challenge: { ok: true, reason: null, list: [] } })
    assert.match(text, /挑战:无进行中的挑战/)
    assert.doesNotMatch(text, /累计/)
})

test('挑战完赛时日报说「已完赛」而不是剩余天数,且不带圆括号', () => {
    const done = { ok: true, list: [{ ...PAID, readSeconds: 108000, readDays: 29, done: true, remainDays: 1, canMiss: 0 }] }
    const text = buildReport({ ...BASE, challenge: done })
    assert.match(text, /已完赛 · 提前 1 天/)
    assert.doesNotMatch(text, /达标奖/)
    assert.doesNotMatch(text, /剩 1 天/)
    assert.doesNotMatch(text, /[()]/)
})

test('signals 对象与旧的顶层写法等价', () => {
    const challenge = { ok: true, list: [FREE] }
    const balance = { ok: true, balance: 16.6, giftBalance: 16.6, expiryBalance: 0 }
    const viaSignals = buildReport({ ...BASE, data: { challenge, balance } })
    const viaTopLevel = buildReport({ ...BASE, challenge, balance })
    assert.equal(viaSignals, viaTopLevel)
})
