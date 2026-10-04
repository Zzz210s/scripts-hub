// 体验卡余额:从 /pay/memberCardSummary 的 remainTime 与 payingRemainTime 推出体验卡天数。
import assert from 'node:assert/strict'
import test from 'node:test'

import { MEMBER_CARD_PATH, buildMemberCardQuery, parseMemberCard, readMemberCard } from '../src/member-card.js'

const sample = { isPaying: 1, remainTime: 294851, payingRemainTime: 35651, day: 121, totalFreeReadDay: 0 }

function fetchCapturing(body, status = 200, sink = null) {
    return async (url, options) => {
        if (sink) sink.push({ url, options })
        return { status, text: async () => body }
    }
}

test('parseMemberCard:体验卡 = 总剩余 - 付费剩余,向下取整到天', () => {
    assert.deepEqual(parseMemberCard(sample), { remainDays: 3, freeCardDays: 3, isPaying: true })
    // 259200 秒整 = 3 天,付费部分不参与体验卡计算
    assert.equal(parseMemberCard({ remainTime: 259200, payingRemainTime: 0 }).freeCardDays, 3)
    assert.equal(parseMemberCard({ remainTime: 100000, payingRemainTime: 90000 }).freeCardDays, 0)
    // 付费剩余超过总剩余时不为负
    assert.equal(parseMemberCard({ remainTime: 1000, payingRemainTime: 999999 }).freeCardDays, 0)
})

test('parseMemberCard:字段缺失 / null / 非对象一律给 0,不抛错', () => {
    assert.deepEqual(parseMemberCard(null), { remainDays: 0, freeCardDays: 0, isPaying: false })
    assert.deepEqual(parseMemberCard('nope'), { remainDays: 0, freeCardDays: 0, isPaying: false })
    assert.deepEqual(parseMemberCard({ remainTime: 'x', payingRemainTime: null }), { remainDays: 0, freeCardDays: 0, isPaying: false })
})

test('readMemberCard GET 到 /pay/memberCardSummary,带 vid / accessToken 与 pf', async () => {
    const sink = []
    const result = await readMemberCard({ token: { vid: 1, accessToken: 'x' }, fetchImpl: fetchCapturing(JSON.stringify(sample), 200, sink) })
    assert.equal(result.ok, true)
    assert.equal(result.freeCardDays, 3)
    assert.equal(result.remainDays, 3)
    assert.equal(result.reason, null)
    assert.match(sink[0].url, new RegExp(`${MEMBER_CARD_PATH.replace(/\//g, '\\/')}\\?pf=`))
    assert.equal(sink[0].options.method, 'GET')
    assert.equal(sink[0].options.headers.vid, '1')
    assert.equal(sink[0].options.headers.accessToken, 'x')
})

test('buildMemberCardQuery 带 pf', () => {
    assert.match(buildMemberCardQuery(), /^\?pf=wechat_wx-2001-android-100-weread$/)
})

test('readMemberCard 非 200 视为失败,天数为 0', async () => {
    const result = await readMemberCard({ token: {}, fetchImpl: fetchCapturing('{"errcode":-2003}', 499) })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'query-failed')
    assert.equal(result.freeCardDays, 0)
})

test('readMemberCard 非 JSON 的 200 响应返回 0 而不是抛错', async () => {
    const result = await readMemberCard({ token: {}, fetchImpl: fetchCapturing('<html>nope</html>') })
    assert.equal(result.ok, true)
    assert.equal(result.freeCardDays, 0)
})

test('readMemberCard 网络异常返回失败对象而不是抛错', async () => {
    const result = await readMemberCard({ token: {}, fetchImpl: async () => { throw new Error('boom') } })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'query-failed')
})

test('readMemberCard 未传 ctx 时也不 reject', async () => {
    const result = await readMemberCard()
    assert.equal(result.ok, false)
})
