import assert from 'node:assert/strict'
import test from 'node:test'

import { callWeekly, claimWeekly, collectWeekly, queryWeekly } from '../src/weekly.js'

const token = { vid: '123', accessToken: 'abc' }

function fakeFetch(handler) {
    const calls = []
    const impl = async (url, options) => {
        calls.push({
            url,
            method: options?.method,
            headers: options?.headers ?? {},
            body: options?.body ? JSON.parse(options.body) : null
        })
        const { status = 200, body } = handler(calls.length - 1)
        return { status, text: async () => JSON.stringify(body ?? {}) }
    }
    impl.calls = calls
    return impl
}

const sample = {
    readingTime: 11161,
    readingDay: 3,
    readtimeAwards: [
        { awardLevelId: 4, awardStatus: 2, awardStatusDesc: '已领取', awardLevelDesc: '读 5 分钟', awardChoices: [{ choiceType: 2, awardNum: 1, canChoice: 1 }] },
        { awardLevelId: 3, awardStatus: 0, awardStatusDesc: '差114分钟', awardLevelDesc: '读 5 小时', awardChoices: [{ choiceType: 2, awardNum: 2, canChoice: 1 }] }
    ],
    readdayAwards: [
        { awardLevelId: 11, awardStatus: 2, awardStatusDesc: '已领取', awardLevelDesc: '读 2 天', awardChoices: [{ choiceType: 2, awardNum: 2, canChoice: 1 }] },
        { awardLevelId: 12, awardStatus: 0, awardStatusDesc: '差1天', awardLevelDesc: '读 4 天', awardChoices: [{ choiceType: 2, awardNum: 4, canChoice: 1 }] }
    ],
    readgoalAwards: []
}

test('callWeekly 固定用 POST,并带上 vid / accessToken 鉴权头', async () => {
    const fetchImpl = fakeFetch(() => ({ body: sample }))
    const result = await callWeekly({ token, fetchImpl }, { awardLevelId: 0 })
    assert.equal(result.ok, true)
    assert.equal(fetchImpl.calls[0].method, 'POST')
    assert.equal(fetchImpl.calls[0].headers.vid, '123')
    assert.equal(fetchImpl.calls[0].headers.accessToken, 'abc')
    assert.equal(fetchImpl.calls[0].url.endsWith('/weekly/exchange'), true)
})

test('callWeekly 响应体不是 JSON 时 body 为空对象', async () => {
    const fetchImpl = async () => ({ status: 200, text: async () => '<html>not json</html>' })
    const result = await callWeekly({ token, fetchImpl }, {})
    assert.equal(result.ok, true)
    assert.deepEqual(result.body, {})
})

test('queryWeekly 解析成功响应', async () => {
    const fetchImpl = fakeFetch(() => ({ body: sample }))
    const result = await queryWeekly({ token, fetchImpl })
    assert.equal(result.ok, true)
    assert.equal(result.readingSeconds, 11161)
    assert.equal(result.awards.length, 4)
    assert.equal(fetchImpl.calls[0].url.endsWith('/weekly/exchange'), true)
    assert.equal(fetchImpl.calls[0].body.isExchangeAward, 0)
    assert.equal(fetchImpl.calls[0].method, 'POST')
    assert.equal(fetchImpl.calls[0].headers.vid, '123')
    assert.equal(fetchImpl.calls[0].headers.accessToken, 'abc')
})

test('queryWeekly 网络异常时返回失败对象而不是抛错', async () => {
    const result = await queryWeekly({ token, fetchImpl: async () => { throw new Error('boom') } })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'query-failed')
})

test('queryWeekly 成功与失败分支字段集合一致', async () => {
    const okKeys = Object.keys(await queryWeekly({ token, fetchImpl: fakeFetch(() => ({ body: sample })) })).sort()
    const failKeys = Object.keys(await queryWeekly({ token, fetchImpl: async () => { throw new Error('boom') } })).sort()
    assert.deepEqual(okKeys, failKeys)
    assert.deepEqual(okKeys, ['awards', 'ok', 'raw', 'readingDays', 'readingSeconds', 'reason'])
})

test('claimWeekly 把业务错误码带出来', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 499, body: { errcode: -2664, errmsg: '-2664' } }))
    const result = await claimWeekly({ token, fetchImpl }, { levelId: 4, choiceType: 2 })
    assert.equal(result.ok, false)
    assert.equal(result.errcode, -2664)
})

test('claimWeekly 把 -2664 标记为已领取而非失败', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 499, body: { errcode: -2664 } }))
    const result = await claimWeekly({ token, fetchImpl }, { levelId: 4, choiceType: 2 })
    assert.equal(result.alreadyClaimed, true)
    assert.equal(fetchImpl.calls[0].method, 'POST')
    assert.equal(fetchImpl.calls[0].headers.vid, '123')
    assert.equal(fetchImpl.calls[0].headers.accessToken, 'abc')
})

test('claimWeekly 网络异常时 errcode 为 null(不是 0)', async () => {
    const result = await claimWeekly({ token, fetchImpl: async () => { throw new Error('boom') } }, { levelId: 1, choiceType: 2 })
    assert.equal(result.ok, false)
    assert.equal(result.errcode, null)
    assert.equal(result.alreadyClaimed, false)
})

test('ctx 缺失时三个入口都返回结果对象而不是 reject', async () => {
    const query = await queryWeekly(undefined)
    assert.equal(query.ok, false)

    const claim = await claimWeekly(undefined, { levelId: 1, choiceType: 2 })
    assert.equal(claim.ok, false)
    assert.equal(claim.errcode, null)

    const collect = await collectWeekly(undefined)
    assert.equal(collect.ok, false)
    assert.equal(collect.reason, 'query-failed')
})

test('collectWeekly 无可领时不发起领取', async () => {
    const fetchImpl = fakeFetch(() => ({ body: { readtimeAwards: [{ awardLevelId: 4, awardStatus: 2, awardChoices: [{ choiceType: 2, awardNum: 1, canChoice: 1 }] }] } }))
    const result = await collectWeekly({ token, fetchImpl })
    assert.equal(result.ok, true)
    assert.equal(result.claimable, 0)
    assert.deepEqual(result.claimed, [])
    assert.deepEqual(result.alreadyClaimed, [])
    assert.equal(fetchImpl.calls.length, 1)
})

test('collectWeekly 领到多档,并逐档记录', async () => {
    const payload = {
        readtimeAwards: [
            { awardLevelId: 1, awardLevelDesc: '读 1 小时', awardStatus: 1, awardChoices: [{ choiceType: 2, awardNum: 2, canChoice: 1 }] },
            { awardLevelId: 2, awardLevelDesc: '读 3 小时', awardStatus: 1, awardChoices: [{ choiceType: 2, awardNum: 2, canChoice: 1 }] }
        ]
    }
    const fetchImpl = fakeFetch(index => (index === 0 ? { body: payload } : { body: {} }))
    const result = await collectWeekly({ token, fetchImpl })
    assert.equal(result.claimable, 2)
    assert.equal(result.claimed.length, 2)
    assert.deepEqual(result.claimed.map(c => c.levelId), [1, 2])
    assert.equal(fetchImpl.calls.length, 3)
    assert.equal(fetchImpl.calls[1].body.isExchangeAward, 1)
})

test('collectWeekly 某档真失败不影响其余档,并记录失败', async () => {
    const payload = {
        readtimeAwards: [
            { awardLevelId: 1, awardLevelDesc: '读 1 小时', awardStatus: 1, awardChoices: [{ choiceType: 2, awardNum: 2, canChoice: 1 }] },
            { awardLevelId: 2, awardLevelDesc: '读 3 小时', awardStatus: 1, awardChoices: [{ choiceType: 2, awardNum: 2, canChoice: 1 }] }
        ]
    }
    const fetchImpl = fakeFetch(index => {
        if (index === 0) return { body: payload }
        if (index === 1) return { status: 500, body: { errcode: -1, errmsg: 'boom' } }
        return { body: {} }
    })
    const result = await collectWeekly({ token, fetchImpl })
    assert.equal(result.claimed.length, 1)
    assert.equal(result.claimed[0].levelId, 2)
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].levelId, 1)
    assert.equal(result.failed[0].errcode, -1)
    assert.deepEqual(result.alreadyClaimed, [])
})

test('collectWeekly 把 -2664 归到已领取,不计失败', async () => {
    const payload = {
        readtimeAwards: [
            { awardLevelId: 1, awardLevelDesc: '读 1 小时', awardStatus: 1, awardChoices: [{ choiceType: 2, awardNum: 2, canChoice: 1 }] },
            { awardLevelId: 2, awardLevelDesc: '读 3 小时', awardStatus: 1, awardChoices: [{ choiceType: 2, awardNum: 2, canChoice: 1 }] }
        ]
    }
    const fetchImpl = fakeFetch(index => {
        if (index === 0) return { body: payload }
        if (index === 1) return { status: 499, body: { errcode: -2664 } }
        return { body: {} }
    })
    const result = await collectWeekly({ token, fetchImpl })
    assert.deepEqual(result.claimed.map(c => c.levelId), [2])
    assert.deepEqual(result.alreadyClaimed.map(c => c.levelId), [1])
    assert.deepEqual(result.failed, [])
})

test('collectWeekly 查询失败时不发起任何领取请求', async () => {
    const fetchImpl = fakeFetch(() => ({ status: 500, body: { errcode: -1 } }))
    const result = await collectWeekly({ token, fetchImpl })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'query-failed')
    assert.equal(fetchImpl.calls.length, 1)
    assert.deepEqual(result.claimed, [])
    assert.deepEqual(result.alreadyClaimed, [])
    assert.deepEqual(result.failed, [])
})

test('collectWeekly 成功与查询失败分支字段集合一致', async () => {
    const okKeys = Object.keys(await collectWeekly({ token, fetchImpl: fakeFetch(() => ({ body: sample })) })).sort()
    const failKeys = Object.keys(await collectWeekly({ token, fetchImpl: async () => { throw new Error('boom') } })).sort()
    assert.deepEqual(okKeys, failKeys)
    assert.deepEqual(okKeys, ['alreadyClaimed', 'claimable', 'claimed', 'failed', 'ok', 'raw', 'readingDays', 'readingSeconds', 'reason', 'tiers'])
})
