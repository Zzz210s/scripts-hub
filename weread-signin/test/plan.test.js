import assert from 'node:assert/strict'
import test from 'node:test'

import { localDay, minutesInWindow, planDay, splitSections } from '../src/plan.js'

const day = iso => Math.floor(new Date(`${iso}T00:00:00`).getTime() / 1000)
const config = {
    challengeStart: '2026-10-01',
    challengeEndsOn: '2026-10-30',
    requiredMinutes: 1800,
    requiredValidDays: 29,
    minValidMinutes: 5,
    slackMinutes: 6,
    dailyCapMinutes: 120,
    sectionMinutes: 30
}
const buckets = [
    { day: '2026-10-01', seconds: 3600 },   // 60 分钟
    { day: '2026-10-02', seconds: 4200 }    // 70 分钟
]

test('minutesInWindow 只统计挑战窗口内的天数', () => {
    const withOutside = [...buckets, { day: '2026-09-30', seconds: 9999 }, { day: '2026-11-01', seconds: 9999 }]
    assert.equal(minutesInWindow(withOutside, '2026-10-01', '2026-10-02'), 130)
})

test('第 3 天:剩余 1670 分钟 / 28 天 -> 每天 60 + 6 余量 = 66', () => {
    const plan = planDay({
        now: new Date('2026-10-03T09:00:00'),
        config,
        buckets,
        todaySeconds: 0
    })
    assert.equal(plan.minutesSoFar, 130)
    assert.equal(plan.remainingMinutes, 1670)
    assert.equal(plan.remainingDays, 28)
    assert.equal(plan.targetMinutes, 66)
    assert.equal(plan.emergency, false)
})

test('今天已经读够时不再安排段落', () => {
    const plan = planDay({
        now: new Date('2026-10-03T21:00:00'),
        config,
        buckets,
        todaySeconds: 66 * 60
    })
    assert.deepEqual(plan.sections, [])
    assert.equal(plan.todayMinutes, 66)
})

test('进度略超前时目标降到个位数(只多读一点)', () => {
    const plan = planDay({
        now: new Date('2026-10-20T09:00:00'),
        config,
        buckets: [{ day: '2026-10-01', seconds: 1780 * 60 }],
        todaySeconds: 0
    })
    assert.equal(plan.remainingMinutes, 20)
    assert.equal(plan.targetMinutes, 8)
})

test('总量已达标时只保留最小有效时长', () => {
    const plan = planDay({
        now: new Date('2026-10-20T09:00:00'),
        config,
        buckets: [{ day: '2026-10-01', seconds: 1800 * 60 }],
        todaySeconds: 0
    })
    assert.equal(plan.remainingMinutes, 0)
    assert.equal(plan.targetMinutes, 5)
})

test('剩最后一天且缺口大 -> 紧急模式,取每日上限', () => {
    const plan = planDay({
        now: new Date('2026-10-30T09:00:00'),
        config,
        buckets: [],
        todaySeconds: 0
    })
    assert.equal(plan.remainingDays, 1)
    assert.equal(plan.targetMinutes, 120)
    assert.equal(plan.emergency, true)
    assert.equal(plan.failableDays, 0)
})

test('可失败天数取"时间容错"与"有效天数容错"的较小值', () => {
    // 第一天还没读:时间上 30-15=15 天,有效天数上 30-29=1 天 -> 取 1
    const first = planDay({ now: new Date('2026-10-01T09:00:00'), config, buckets: [], todaySeconds: 0 })
    assert.equal(first.remainingDays, 30)
    assert.equal(first.timeSlack, 15)
    assert.equal(first.daySlack, 1)
    assert.equal(first.failableDays, 1)
    assert.equal(first.validDaysSoFar, 0)

    // 今天已读满(有效):剩余 29 天里还要 28 个有效日 -> 只能再漏 1 天
    const afterToday = planDay({
        now: new Date('2026-10-01T22:00:00'), config,
        buckets: [{ day: '2026-10-01', seconds: 66 * 60 }], todaySeconds: 66 * 60
    })
    assert.equal(afterToday.validDaysSoFar, 1)
    assert.equal(afterToday.validNeeded, 28)
    assert.equal(afterToday.daySlack, 1)
    assert.equal(afterToday.failableDays, 1)
})

test('总量已达标但有效天数还差时,容错按有效天数算', () => {
    const plan = planDay({
        now: new Date('2026-10-20T09:00:00'), config,
        buckets: [
            { day: '2026-10-01', seconds: 1800 * 60 },
            { day: '2026-10-02', seconds: 6 * 60 }
        ],
        todaySeconds: 6 * 60
    })
    assert.equal(plan.remainingMinutes, 0)
    assert.equal(plan.targetMinutes, 5)
    assert.equal(plan.validDaysSoFar, 2)
    assert.equal(plan.validNeeded, 27)
    assert.equal(plan.remainingDays, 11)
    assert.equal(plan.daySlack, 0)   // 11 天里还要 27 个有效日?不会发生:validNeeded 已受 remainingDays 限制
})

test('splitSections 按单段上限切分', () => {
    assert.deepEqual(splitSections(66, 30), [{ minutes: 30 }, { minutes: 30 }, { minutes: 6 }])
    assert.deepEqual(splitSections(0, 30), [])
})

test('localDay 用本机时区', () => {
    assert.equal(localDay(new Date('2026-10-03T23:30:00')), '2026-10-03')
    assert.equal(localDay(new Date(day('2026-10-04') * 1000)), '2026-10-04')
})
