import assert from 'node:assert/strict'
import test from 'node:test'

import { buildClaimBody, buildStatusBody, parseWeekly, pickClaim } from '../src/weekly.js'

const sample = {
    readingTime: 11161,
    readingDay: 3,
    readtimeAwards: [
        { awardLevelId: 4, awardStatus: 2, awardStatusDesc: '已领取', awardLevelDesc: '读 5 分钟', awardChoicesDesc: '可得 1 天体验卡或 1 书币', awardChoices: [{ choiceType: 1, awardNum: 1, canChoice: 1 }, { choiceType: 2, awardNum: 1, canChoice: 1 }] },
        { awardLevelId: 3, awardStatus: 0, awardStatusDesc: '差114分钟', awardLevelDesc: '读 5 小时', awardChoicesDesc: '可得 2 天体验卡或 2 书币', awardChoices: [{ choiceType: 1, awardNum: 2, canChoice: 1 }, { choiceType: 2, awardNum: 2, canChoice: 1 }] }
    ],
    readdayAwards: [
        { awardLevelId: 11, awardStatus: 2, awardStatusDesc: '已领取', awardLevelDesc: '读 2 天', awardChoicesDesc: '可得 2 天体验卡或 2 书币', awardChoices: [{ choiceType: 1, awardNum: 2, canChoice: 1 }, { choiceType: 2, awardNum: 2, canChoice: 1 }] },
        { awardLevelId: 12, awardStatus: 0, awardStatusDesc: '差1天', awardLevelDesc: '读 4 天', awardChoicesDesc: '可得 2 天体验卡或 4 书币', awardChoices: [{ choiceType: 1, awardNum: 2, canChoice: 1 }, { choiceType: 2, awardNum: 4, canChoice: 1 }] }
    ],
    readgoalAwards: []
}

test('buildStatusBody 用抓包确认的固定字段', () => {
    assert.deepEqual(buildStatusBody(), {
        awardLevelId: 0, awardChoiceType: 0, isExchangeAward: 0,
        isVisitReadGoal: 1, unread: 1, pf: 'wechat_wx-2001-android-100-weread'
    })
})

test('buildClaimBody 带档位与选项类型,并置 isExchangeAward=1', () => {
    assert.deepEqual(buildClaimBody({ levelId: 1, choiceType: 2 }), {
        awardLevelId: 1, awardChoiceType: 2, isExchangeAward: 1,
        isVisitReadGoal: 1, unread: 1, pf: 'wechat_wx-2001-android-100-weread'
    })
})

test('buildClaimBody 无参或 null 时不抛错,只留 undefined 占位', () => {
    const noArg = buildClaimBody()
    assert.equal(noArg.isExchangeAward, 1)
    assert.equal(noArg.awardLevelId, undefined)
    assert.equal(noArg.awardChoiceType, undefined)

    const fromNull = buildClaimBody(null)
    assert.equal(fromNull.isExchangeAward, 1)
    assert.equal(fromNull.awardLevelId, undefined)
})

test('parseWeekly 合并时长档与天数档,并给缺失字段安全默认值', () => {
    const parsed = parseWeekly(sample)
    assert.equal(parsed.readingSeconds, 11161)
    assert.equal(parsed.readingDays, 3)
    assert.equal(parsed.awards.length, 4)
    assert.deepEqual(parsed.awards.map(a => a.levelId), [4, 3, 11, 12])
    assert.deepEqual(parsed.awards[0].choices, [{ choiceType: 1, awardNum: 1, canChoice: 1 }, { choiceType: 2, awardNum: 1, canChoice: 1 }])
    assert.deepEqual(parseWeekly(null), { readingSeconds: 0, readingDays: 0, awards: [] })
    assert.deepEqual(parseWeekly({ readtimeAwards: 'x' }).awards, [])
})

test('parseWeekly 目标档有内容时同样合并', () => {
    const parsed = parseWeekly({
        readgoalAwards: [
            { awardLevelId: 21, awardStatus: 1, awardStatusDesc: '可领', awardLevelDesc: '读满目标', awardChoices: [{ choiceType: 2, awardNum: 3, canChoice: 1 }] }
        ]
    })
    assert.deepEqual(parsed.awards.map(a => a.levelId), [21])
    assert.deepEqual(parsed.awards[0].choices, [{ choiceType: 2, awardNum: 3, canChoice: 1 }])
})

test('pickClaim 书币优先,书币不可选时退回体验卡', () => {
    const coinFirst = pickClaim([
        { levelId: 3, levelDesc: '读 5 小时', status: 1, choices: [{ choiceType: 2, awardNum: 2, canChoice: 1 }, { choiceType: 1, awardNum: 2, canChoice: 1 }] }
    ])
    assert.deepEqual(coinFirst, [{ levelId: 3, levelDesc: '读 5 小时', choiceType: 2, awardNum: 2 }])

    const cardFallback = pickClaim([
        { levelId: 3, levelDesc: '读 5 小时', status: 1, choices: [{ choiceType: 2, awardNum: 2, canChoice: 0 }, { choiceType: 1, awardNum: 2, canChoice: 1 }] }
    ])
    assert.deepEqual(cardFallback, [{ levelId: 3, levelDesc: '读 5 小时', choiceType: 1, awardNum: 2 }])
})

test('pickClaim 跳过已领取与未达成,未知状态才入列', () => {
    const claims = pickClaim([
        { levelId: 4, levelDesc: '已领', status: 2, choices: [{ choiceType: 2, awardNum: 1, canChoice: 1 }] },
        { levelId: 3, levelDesc: '未达成', status: 0, choices: [{ choiceType: 2, awardNum: 2, canChoice: 1 }] },
        { levelId: 1, levelDesc: '可领', status: 1, choices: [{ choiceType: 2, awardNum: 2, canChoice: 1 }] },
        { levelId: 2, levelDesc: '未知', status: 7, choices: [{ choiceType: 2, awardNum: 2, canChoice: 1 }] }
    ])
    assert.deepEqual(claims.map(c => c.levelId), [1, 2])
})

test('pickClaim 两个选项都不可选时跳过', () => {
    const claims = pickClaim([{ levelId: 1, levelDesc: 'x', status: 1, choices: [{ choiceType: 2, awardNum: 2, canChoice: 0 }, { choiceType: 1, awardNum: 1, canChoice: 0 }] }])
    assert.deepEqual(claims, [])
})

test('pickClaim 容错:null 项与缺 choices 都跳过,空/缺参数返回空数组', () => {
    assert.deepEqual(pickClaim([null]), [])
    assert.deepEqual(pickClaim([{ levelId: 1, levelDesc: 'x', status: 1 }]), [])
    assert.deepEqual(pickClaim([]), [])
    assert.deepEqual(pickClaim(), [])
})
