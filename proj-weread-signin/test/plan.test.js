import assert from 'node:assert/strict'
import test from 'node:test'

import { activeChallenge } from '../src/challenge.js'
import { localDay, minutesInWindow, planDay, splitSections, windowFromChallenge } from '../src/plan.js'

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

// ── 2026-10-30 那次的回归:统计接口以为已经达标,挑战接口还差 11 分钟 ──────────────
//
// 当时的现场:挑战 readSeconds=107340 / targetSeconds=108000(差 660 秒 = 11 分钟),
// remainDays=0 也就是当天是最后一天。计划层信了统计接口,算出「剩 0 分钟」,只安排 5 分钟,
// 于是这个 30 天挑战以「差 11 分钟」失败。下面三条把这次事故钉死。

const LAST_DAY = new Date('2026-10-30T09:00:00')

test('回归:统计说达标、挑战说差 11 分钟时,以挑战为准并且当天必须补齐', () => {
    const plan = planDay({
        now: LAST_DAY,
        config,
        // 统计接口给的分桶故意多报:加起来已经超过 1800 分钟
        buckets: [{ day: '2026-10-30', seconds: 1830 * 60 }],
        todaySeconds: 0,
        challenge: { readSeconds: 107340, targetSeconds: 108000, remainDays: 0, readDays: 30, targetDays: 29 }
    })
    assert.equal(plan.progressSource, 'challenge')
    assert.equal(plan.minutesSoFar, 1789) // 107340 / 60 向下取整,不许四舍五入成 1789 以上
    // 目标 = 1800 + 30 分钟余量 = 1830
    assert.equal(plan.requiredMinutes, 1830)
    assert.equal(plan.deficitMinutes, 41)
    // 最后一天不再分摊:今天就要把缺口补上,而不是按 minValidMinutes 意思一下
    assert.equal(plan.targetMinutes, 41)
    assert.equal(plan.runMinutes, 41)
})

test('回归:最后一天缺口大于每日上限时,目标顶到上限并明确标记做不到', () => {
    const plan = planDay({
        now: LAST_DAY,
        config: { ...config, dailyCapMinutes: 120 },
        buckets: [],
        todaySeconds: 0,
        challenge: { readSeconds: 90000, targetSeconds: 108000, remainDays: 0 }
    })
    // 缺口 1830 - 1500 = 330 分钟,一天最多 120
    assert.equal(plan.unreachable, true)
    assert.equal(plan.targetMinutes, 120)
})

test('挑战还剩几天时按剩余天数均摊,余量包含在目标里', () => {
    const plan = planDay({
        now: new Date('2026-10-20T09:00:00'),
        config,
        buckets: [],
        todaySeconds: 0,
        // 还剩 11 天(remainDays=10)
        challenge: { readSeconds: 800 * 60, targetSeconds: 108000, remainDays: 10 }
    })
    // 需求 1830 - 已读 800 = 1030 分钟 / 11 天 = 94 分钟,再加 6 分钟漏计余量
    assert.equal(plan.remainingDays, 11)
    assert.equal(plan.targetMinutes, 100)
})

test('没有挑战数据时回落到统计口径,并如实标出来源', () => {
    const plan = planDay({ now: LAST_DAY, config, buckets: [{ day: '2026-10-30', seconds: 30 * 60 }], todaySeconds: 30 * 60 })
    assert.equal(plan.progressSource, 'stats')
    assert.equal(plan.requiredMinutes, config.requiredMinutes)
})

test('挑战窗口从接口反推:换了挑战不用再手改 .env', () => {
    // 2026-10-31 00:00 → 2026-11-30 00:00 的挑战
    const window = windowFromChallenge({ startTime: 1793376000, endTime: 1795968000 })
    assert.deepEqual(window, { start: '2026-10-31', end: '2026-11-29' })
    assert.equal(windowFromChallenge({}), null)
})

test('已完赛与已过期的挑战不参与计划', () => {
    const done = activeChallenge({ list: [{ id: 'a', status: 1, isPaid: true, done: true, remainDays: 3, targetSeconds: 108000, readSeconds: 108000 }] })
    assert.equal(done, null)
    const expired = activeChallenge({ list: [{ id: 'a', status: 1, isPaid: true, done: false, remainDays: -1, targetSeconds: 108000, readSeconds: 100 }] })
    assert.equal(expired, null)
    const live = activeChallenge({ list: [{ id: 'a', status: 1, isPaid: true, done: false, remainDays: 5, targetSeconds: 108000, readSeconds: 100 }] })
    assert.equal(live.id, 'a')
})

test('会话循环重算也走挑战真值:统计口径说达标时不提前收工', async () => {
    const { makeLivePlanner } = await import('../src/plan-live.js')
    const replan = makeLivePlanner({
        cwd: '.', config, now: LAST_DAY,
        deps: {
            readChallengeOnly: async () => ({
                ok: true,
                list: [{ id: 'x', status: 1, isPaid: true, done: false, remainDays: 0, targetSeconds: 108000, readSeconds: 107340, readDays: 30, targetDays: 29, startTime: 1793376000, endTime: 1795968000 }]
            })
        },
        // 统计口径给了很多分钟(足够「达标」),但挑战还差 11 分钟
        getStats: () => ({ buckets: [{ day: '2026-10-30', seconds: 1900 * 60 }] }),
        getAttempts: () => 1
    })
    const plan = await replan(1900 * 60)
    assert.equal(plan.progressSource, 'challenge')
    assert.equal(plan.targetMinutes, 41) // 最后一天必须补齐缺口
})
