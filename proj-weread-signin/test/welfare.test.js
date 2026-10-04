import assert from 'node:assert/strict'
import test from 'node:test'

import { buildClaim, buildQuery, callWelfare, claimIfAvailable, decideClaim, parseWelfare } from '../src/welfare.js'

const token = { vid: '123', accessToken: 'abc' }

function fakeFetch(routes) {
    const calls = []
    const impl = async (url) => {
        calls.push(url)
        const action = new URL(url).searchParams.get('action')
        const handler = routes[action]
        if (!handler) throw new Error(`未预期的 action:${action}`)
        return handler()
    }
    impl.calls = calls
    return impl
}

function jsonResponse(body, status = 200) {
    return {
        status,
        text: async () => JSON.stringify(body)
    }
}

test('buildQuery 把 chapterUid 归一成整数,缺省为 0', () => {
    assert.deepEqual(buildQuery({ bookId: 'b1', chapterUid: '42' }), { action: 'query', bookId: 'b1', chapterUid: 42 })
    assert.deepEqual(buildQuery({ bookId: 'b1' }), { action: 'query', bookId: 'b1', chapterUid: 0 })
    assert.deepEqual(buildQuery({ bookId: 'b1', chapterUid: 'x' }), { action: 'query', bookId: 'b1', chapterUid: 0 })
})

test('buildClaim 只带 bookId 与 key', () => {
    assert.deepEqual(buildClaim({ bookId: 'b1', key: 'k1' }), { action: 'recv', bookId: 'b1', key: 'k1' })
})

test('parseWelfare 对缺失与异常字段给安全默认值', () => {
    assert.deepEqual(parseWelfare({ coin: 3, key: 'k', title: 't', buttonTitle: 'b', type: 3 }),
        { coin: 3, key: 'k', title: 't', buttonTitle: 'b', type: 3 })
    assert.deepEqual(parseWelfare({ coin: 0 }), { coin: 0, key: '', title: '', buttonTitle: '', type: 0 })
    assert.deepEqual(parseWelfare({ coin: '5' }).coin, 5)
    assert.deepEqual(parseWelfare(null), { coin: 0, key: '', title: '', buttonTitle: '', type: 0 })
    assert.deepEqual(parseWelfare('not json'), { coin: 0, key: '', title: '', buttonTitle: '', type: 0 })
})

test('decideClaim 只在有书币且有 key 时领取', () => {
    assert.deepEqual(decideClaim({ coin: 3, key: 'k' }), { claim: true, reason: 'claimable' })
    assert.deepEqual(decideClaim({ coin: 0, key: 'k' }), { claim: false, reason: 'no-coin' })
    assert.deepEqual(decideClaim({ coin: 3, key: '' }), { claim: false, reason: 'no-key' })
    assert.deepEqual(decideClaim(null), { claim: false, reason: 'no-coin' })
})

test('callWelfare 网络异常时返回失败对象而不是抛错', async () => {
    const result = await callWelfare({ token, fetchImpl: async () => { throw new Error('boom') } }, buildQuery({ bookId: 'b1' }))
    assert.equal(result.ok, false)
    assert.equal(result.error, 'boom')
})

test('claimIfAvailable:无可领书币时不领取', async () => {
    const fetchImpl = fakeFetch({ query: () => jsonResponse({ coin: 0 }) })
    const result = await claimIfAvailable({ token, bookId: 'b1', chapterUid: 0, fetchImpl })
    assert.equal(result.claimed, false)
    assert.equal(result.reason, 'no-coin')
    assert.equal(fetchImpl.calls.length, 1)
})

test('claimIfAvailable:有书币时领取并用再次查询自证', async () => {
    let queryCount = 0
    const fetchImpl = fakeFetch({
        query: () => jsonResponse(queryCount++ === 0 ? { coin: 5, key: 'k1', title: '阅读福利' } : { coin: 0 }),
        recv: () => jsonResponse({})
    })
    const result = await claimIfAvailable({ token, bookId: 'b1', chapterUid: 7, fetchImpl })
    assert.equal(result.claimed, true)
    assert.equal(result.coin, 5)
    assert.equal(result.reason, 'claimable')
    assert.equal(result.verified, true)
    assert.equal(fetchImpl.calls.length, 3)
})

test('claimIfAvailable:领取请求失败时如实报告,不假装成功', async () => {
    const fetchImpl = fakeFetch({
        query: () => jsonResponse({ coin: 5, key: 'k1' }),
        recv: () => jsonResponse({ errcode: -1 }, 500)
    })
    const result = await claimIfAvailable({ token, bookId: 'b1', chapterUid: 0, fetchImpl })
    assert.equal(result.claimed, false)
    assert.equal(result.reason, 'claim-failed')
    assert.equal(result.ok, false)
})

test('claimIfAvailable:领取成功但自证仍是 0 之外的值时标注未确认', async () => {
    const fetchImpl = fakeFetch({
        query: () => jsonResponse({ coin: 5, key: 'k1' }),
        recv: () => jsonResponse({})
    })
    const result = await claimIfAvailable({ token, bookId: 'b1', chapterUid: 0, fetchImpl })
    assert.equal(result.claimed, true)
    assert.equal(result.verified, false)
})

test('decideClaim 对缺失 coin 不能 fail-open', () => {
    assert.deepEqual(decideClaim({ key: 'k' }), { claim: false, reason: 'no-coin' })
    assert.deepEqual(decideClaim({ coin: undefined, key: 'k' }), { claim: false, reason: 'no-coin' })
    assert.deepEqual(decideClaim({ coin: 'abc', key: 'k' }), { claim: false, reason: 'no-coin' })
})

test('claimIfAvailable:查询失败时也返回完整字段,且 reason 为 query-failed', async () => {
    const fetchImpl = fakeFetch({ query: () => jsonResponse({ errcode: -1 }, 500) })
    const result = await claimIfAvailable({ token, bookId: 'b1', chapterUid: 0, fetchImpl })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'query-failed')
    assert.equal(result.claimed, false)
    assert.equal(result.coin, 0)
    assert.equal(result.claimRaw, null)
    assert.equal(result.verifyRaw, null)
})

test('claimIfAvailable:自证请求本身失败时 verifyOk 为 false', async () => {
    let queryCount = 0
    const fetchImpl = fakeFetch({
        query: () => (queryCount++ === 0 ? jsonResponse({ coin: 5, key: 'k1' }) : jsonResponse({ errcode: -1 }, 500)),
        recv: () => jsonResponse({})
    })
    const result = await claimIfAvailable({ token, bookId: 'b1', chapterUid: 0, fetchImpl })
    assert.equal(result.claimed, true)
    assert.equal(result.verifyOk, false)
    assert.equal(result.verified, false)
})

test('callWelfare 对非 JSON 响应不抛错', async () => {
    const result = await callWelfare({ token, fetchImpl: async () => ({ status: 200, text: async () => 'not json' }) }, buildQuery({ bookId: 'b1' }))
    assert.equal(result.ok, true)
    assert.deepEqual(result.body, {})
})

test('claimIfAvailable 的调用顺序是 query → recv → query', async () => {
    let queryCount = 0
    const fetchImpl = fakeFetch({
        query: () => jsonResponse(queryCount++ === 0 ? { coin: 5, key: 'k1' } : { coin: 0 }),
        recv: () => jsonResponse({})
    })
    await claimIfAvailable({ token, bookId: 'b1', chapterUid: 0, fetchImpl })
    assert.match(fetchImpl.calls[0], /action=query/)
    assert.match(fetchImpl.calls[1], /action=recv/)
    assert.match(fetchImpl.calls[2], /action=query/)
})
