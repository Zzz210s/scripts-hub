// 当日可跑窗口与「按窗口校正目标」:边界钉住(窗口不足 / 有效日下限 / 单次上限 / 剩余 1 天)。
import assert from 'node:assert/strict'
import test from 'node:test'

import { availableWindow } from '../src/clock.js'
import { planDay } from '../src/plan.js'

const WINDOW_CONFIG = {
    quietStart: '20:00',
    quietEnd: '23:00',
    shutdownTime: '02:00',
    shutdownGuardMinutes: 30,
    runTimeoutMinutes: 100,
    maxAttemptsPerDay: 3
}

const CONFIG = {
    challengeStart: '2026-10-01',
    challengeEndsOn: '2026-10-30',
    requiredMinutes: 1800,
    requiredValidDays: 29,
    minValidMinutes: 5,
    slackMinutes: 6,
    dailyCapMinutes: 120,
    sectionMinutes: 30,
    ...WINDOW_CONFIG
}
const BUCKETS = [
    { day: '2026-10-01', seconds: 3600 },   // 60 分钟
    { day: '2026-10-02', seconds: 4200 }    // 70 分钟
]

test('availableWindow:白天取「剩余次数 × 单次上限」,不超 300 分钟', () => {
    assert.equal(availableWindow(new Date('2026-10-03T09:00:00'), WINDOW_CONFIG), 300)
})

test('availableWindow:临近安静时段时窗口收窄到安静开始', () => {
    assert.equal(availableWindow(new Date('2026-10-03T19:50:00'), WINDOW_CONFIG), 10)
})

test('availableWindow:正处安静时段返回 0', () => {
    assert.equal(availableWindow(new Date('2026-10-03T21:00:00'), WINDOW_CONFIG), 0)
})

test('availableWindow:安静时段结束后受关机避让限制', () => {
    // 23:30 -> 02:00 是 150 分钟,再减 30 分钟避让 = 120
    assert.equal(availableWindow(new Date('2026-10-03T23:30:00'), WINDOW_CONFIG), 120)
})

test('availableWindow:距关机不足避让线返回 0', () => {
    assert.equal(availableWindow(new Date('2026-10-04T01:45:00'), WINDOW_CONFIG), 0)
})

test('availableWindow:用掉尝试次数后窗口按剩余次数缩小', () => {
    assert.equal(availableWindow(new Date('2026-10-03T13:00:00'), WINDOW_CONFIG, 2), 100)
})

test('availableWindow:配置缺失时不设限,安静时段判断也不触发', () => {
    assert.equal(availableWindow(new Date('2026-10-03T09:00:00'), {}), 300)
})

test('目标按窗口下调:19:50 只剩 10 分钟,目标从 66 降到 10,段落与之一致', () => {
    const plan = planDay({ now: new Date('2026-10-03T19:50:00'), config: CONFIG, buckets: BUCKETS, todaySeconds: 0 })
    assert.equal(plan.windowMinutes, 10)
    assert.equal(plan.plannedMinutes, 66)
    assert.equal(plan.targetMinutes, 10)
    assert.equal(plan.windowCapped, true)
    assert.equal(plan.runMinutes, 10)
    assert.deepEqual(plan.sections, [{ minutes: 10 }])
})

test('已读部分计入可达值:今日已读 53 分钟时目标 63、只需再跑 10 分钟', () => {
    const plan = planDay({ now: new Date('2026-10-03T19:50:00'), config: CONFIG, buckets: BUCKETS, todaySeconds: 53 * 60 })
    assert.equal(plan.targetMinutes, 63)
    assert.equal(plan.runMinutes, 10)
    assert.equal(plan.windowCapped, true)
    assert.deepEqual(plan.sections, [{ minutes: 10 }])
})

test('窗口再小也不低于有效日下限', () => {
    const plan = planDay({ now: new Date('2026-10-03T19:59:00'), config: CONFIG, buckets: BUCKETS, todaySeconds: 0 })
    assert.equal(plan.windowMinutes, 1)
    assert.equal(plan.targetMinutes, 5)
    assert.equal(plan.runMinutes, 5)
})

test('单次会话上限:最后一天目标 120 也只写 100,差额留给下一次触发', () => {
    const plan = planDay({ now: new Date('2026-10-30T09:00:00'), config: CONFIG, buckets: [], todaySeconds: 0 })
    assert.equal(plan.remainingDays, 1)
    assert.equal(plan.targetMinutes, 120)
    assert.equal(plan.stillNeeded, 120)
    assert.equal(plan.runMinutes, 100)
    assert.equal(plan.emergency, true)
})

test('挑战已结束时剩余天数按 1 天算,不出现 0 或负数', () => {
    const plan = planDay({ now: new Date('2026-11-05T09:00:00'), config: CONFIG, buckets: [], todaySeconds: 0 })
    assert.equal(plan.remainingDays, 1)
    assert.ok(plan.runMinutes >= 0)
})

test('总量已达标时目标仍不低于有效日下限', () => {
    const plan = planDay({
        now: new Date('2026-10-20T09:00:00'), config: CONFIG,
        buckets: [{ day: '2026-10-01', seconds: 1800 * 60 }], todaySeconds: 0
    })
    assert.equal(plan.remainingMinutes, 0)
    assert.equal(plan.targetMinutes, 5)
    assert.equal(plan.runMinutes, 5)
})

test('今日已达标时不再安排会话', () => {
    const plan = planDay({
        now: new Date('2026-10-20T09:00:00'), config: CONFIG,
        buckets: [{ day: '2026-10-01', seconds: 1800 * 60 }], todaySeconds: 5 * 60
    })
    assert.equal(plan.runMinutes, 0)
    assert.deepEqual(plan.sections, [])
})
