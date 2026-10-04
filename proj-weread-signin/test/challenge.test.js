import assert from 'node:assert/strict'
import test from 'node:test'

import { CHALLENGE_PATH, collectChallenge, parseChallenges, pickChallenges, queryChallenges, summarize } from '../src/challenge.js'

// 2026-10-02 真实回包节选(design 2.1):付费 readchallenge4 + 免费 ChallengeLongTermFree。
const sample = {
    challengeList: [
        {
            vid: 547414326, id: 'ChallengeLongTermFree', status: 1, startTime: 1790784000, endTime: 1792598400,
            readTime: 9360, readDateList: [1790784000, 1790870400], remainDays: 19, currentTime: 1790947831,
            challenge: { challengeDay: 21, targetDay: 21, targetTime: 36000, reachRewardCoin: 0 }
        },
        {
            id: 'readchallenge4', status: 1, signQualified: 0, signedList: [], startTime: 1790784000, endTime: 1793376000,
            readTime: 9360, readDateList: [1790784000, 1790870400], currentTime: 1790947831,
            challenge: { challengeDay: 30, targetDay: 29, targetTime: 108000, price: 500, reachRewardCoin: 30, reachRewardCard: 30, extraRewardCoin: 10, extraRewardCard: 5 }
        }
    ]
}

function fetchReturning(body, status = 200) {
    return async () => ({ status, text: async () => body })
}

test('CHALLENGE_PATH 是实测确认的查询串', () => {
    assert.equal(CHALLENGE_PATH, '/challenge/detail?version=v3&scene=2')
})

test('parseChallenges 解析付费与免费两条挑战', () => {
    const list = parseChallenges(sample)
    assert.equal(list.length, 2)

    const free = list[0]
    assert.equal(free.id, 'ChallengeLongTermFree')
    assert.equal(free.isPaid, false)
    assert.equal(free.totalDays, 21)
    assert.equal(free.targetDays, 21)
    assert.equal(free.targetSeconds, 36000)
    assert.equal(free.readSeconds, 9360)
    assert.equal(free.readDays, 2)
    assert.equal(free.rewardCoin, 0)
    assert.equal(free.rewardCard, 0)
    assert.equal(free.extraRewardCoin, 0)
    assert.equal(free.startTime, 1790784000)
    assert.equal(free.endTime, 1792598400)

    const paid = list[1]
    assert.equal(paid.id, 'readchallenge4')
    assert.equal(paid.isPaid, true)
    assert.equal(paid.totalDays, 30)
    assert.equal(paid.targetDays, 29)
    assert.equal(paid.targetSeconds, 108000)
    assert.equal(paid.readSeconds, 9360)
    assert.equal(paid.readDays, 2)
    assert.equal(paid.rewardCoin, 30)
    assert.equal(paid.rewardCard, 30)
    assert.equal(paid.extraRewardCoin, 10)
    assert.equal(paid.extraRewardCard, 5)
})

test('parseChallenges 的 readDays 取 readDateList.length,不是 challengeDay', () => {
    const [entry] = parseChallenges({ challengeList: [{ id: 'x', status: 1, readDateList: [1, 2, 3], challenge: { challengeDay: 30 } }] })
    assert.equal(entry.readDays, 3)
    assert.equal(entry.totalDays, 30)
})

test('parseChallenges 的 remainDays 用 endTime-currentTime 计算,并与服务端一致', () => {
    const [free, paid] = parseChallenges(sample)
    assert.equal(free.remainDays, 19)
    assert.equal(paid.remainDays, 28)
    assert.equal(free.remainDays, sample.challengeList[0].remainDays)
})

test('parseChallenges 的 remainDays 已过期时取 0(不出现负数)', () => {
    const [entry] = parseChallenges({ challengeList: [{ id: 'x', status: 1, startTime: 100, endTime: 200, currentTime: 1000, readDateList: [] }] })
    assert.equal(entry.remainDays, 0)
})

test('parseChallenges 对缺失与异常字段给安全默认值,不抛错', () => {
    assert.deepEqual(parseChallenges(null), [])
    assert.deepEqual(parseChallenges(undefined), [])
    assert.deepEqual(parseChallenges({}), [])
    assert.deepEqual(parseChallenges({ challengeList: 'x' }), [])

    const [entry] = parseChallenges({ challengeList: [{ status: 1 }] })
    assert.equal(entry.id, '')
    assert.equal(entry.isPaid, false)
    assert.equal(entry.totalDays, 0)
    assert.equal(entry.targetDays, 0)
    assert.equal(entry.targetSeconds, 0)
    assert.equal(entry.readSeconds, 0)
    assert.equal(entry.readDays, 0)
    assert.equal(entry.remainDays, 0)
    assert.equal(entry.rewardCoin, 0)
    assert.equal(entry.rewardCard, 0)
    assert.equal(entry.extraRewardCoin, 0)
    assert.equal(entry.extraRewardCard, 0)
    assert.equal(entry.startTime, 0)
    assert.equal(entry.endTime, 0)
})

test('parseChallenges 列表项为 null 也不抛错', () => {
    const [entry] = parseChallenges({ challengeList: [null] })
    assert.equal(entry.id, '')
    assert.equal(entry.readDays, 0)
})

test('pickChallenges 只留进行中,付费在前', () => {
    const entries = [
        { id: 'free', status: 1, isPaid: false },
        { id: 'paid', status: 1, isPaid: true },
        { id: 'ended', status: 2, isPaid: true },
        { id: 'notstarted', status: 0, isPaid: false }
    ]
    assert.deepEqual(pickChallenges(entries).map(e => e.id), ['paid', 'free'])
    assert.deepEqual(pickChallenges([]), [])
    assert.deepEqual(pickChallenges(), [])
})

test('summarize 的 canMiss:正数保留、负数取 0、刚好耗尽为 0', () => {
    assert.equal(summarize({ readDays: 2, targetDays: 29, remainDays: 28 }).canMiss, 1)
    assert.equal(summarize({ readDays: 0, targetDays: 21, remainDays: 3 }).canMiss, 0)
    assert.equal(summarize({ readDays: 29, targetDays: 29, remainDays: 0 }).canMiss, 0)
    assert.equal(summarize({ readDays: 25, targetDays: 29, remainDays: 28 }).canMiss, 24)
})

test('summarize 的 done 需要天数与时长双达标', () => {
    assert.equal(summarize({ readDays: 29, targetDays: 29, readSeconds: 108000, targetSeconds: 108000, remainDays: 0 }).done, true)
    assert.equal(summarize({ readDays: 29, targetDays: 29, readSeconds: 107999, targetSeconds: 108000, remainDays: 0 }).done, false)
    assert.equal(summarize({ readDays: 28, targetDays: 29, readSeconds: 108000, targetSeconds: 108000, remainDays: 1 }).done, false)
})

test('summarize 无参不抛错,全部取安全值', () => {
    assert.deepEqual(summarize(), { remainDays: 0, canMiss: 0, done: true })
})

test('queryChallenges 网络异常返回失败对象而不是抛错', async () => {
    const result = await queryChallenges({ token: {}, fetchImpl: async () => { throw new Error('boom') } })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'query-failed')
    assert.deepEqual(result.list, [])
})

test('queryChallenges 未传 ctx 时也不 reject', async () => {
    const result = await queryChallenges()
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'query-failed')
})

test('queryChallenges 成功返回 list,非 JSON 响应当空对象', async () => {
    const ok = await queryChallenges({ token: { vid: 1, accessToken: 'x' }, fetchImpl: fetchReturning(JSON.stringify(sample)) })
    assert.equal(ok.ok, true)
    assert.equal(ok.reason, null)
    assert.equal(ok.list.length, 2)
    assert.equal(ok.raw.status, 200)

    const notJson = await queryChallenges({ token: {}, fetchImpl: fetchReturning('<html>nope</html>') })
    assert.equal(notJson.ok, true)
    assert.deepEqual(notJson.list, [])
})

test('queryChallenges 非 200 视为失败', async () => {
    const result = await queryChallenges({ token: {}, fetchImpl: fetchReturning('{}', 499) })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'query-failed')
})

test('collectChallenge 查询失败时返回 ok:false 与原因', async () => {
    const result = await collectChallenge({ token: {}, fetchImpl: async () => { throw new Error('boom') } })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'query-failed')
    assert.deepEqual(result.list, [])
})

test('collectChallenge 成功时挑选进行中并带上派生值', async () => {
    const result = await collectChallenge({ token: { vid: 1, accessToken: 'x' }, fetchImpl: fetchReturning(JSON.stringify(sample)) })
    assert.equal(result.ok, true)
    assert.deepEqual(result.list.map(e => e.id), ['readchallenge4', 'ChallengeLongTermFree'])
    assert.equal(result.list[0].canMiss, 1)
    assert.equal(result.list[0].done, false)
    assert.equal(result.list[1].canMiss, 0)
})
