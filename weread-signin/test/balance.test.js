import assert from 'node:assert/strict'
import test from 'node:test'

import { BALANCE_PATH, buildBalanceBody, parseBalance, readBalance } from '../src/balance.js'
import { CLIENT_PF } from '../src/weekly.js'

// 2026-10-02 真实回包(design 2.2)。
const sample = {
    balance: 16.60, giftBalance: 16.60, peerBalance: 0, peerGiftBalance: 0,
    expiryBalance: 0, peerExpiryBalance: 0, isPromoting: 0, paperBalance: 0, incentive: 0
}

function fetchCapturing(body, status = 200, sink = {}) {
    return async (url, options) => {
        sink.url = url
        sink.options = options
        return { status, text: async () => body }
    }
}

test('BALANCE_PATH 是实测确认的路径', () => {
    assert.equal(BALANCE_PATH, '/pay/balance')
})

test('buildBalanceBody 复用 weekly 的 CLIENT_PF', () => {
    assert.deepEqual(buildBalanceBody(), { pf: CLIENT_PF })
    assert.equal(buildBalanceBody().pf, 'wechat_wx-2001-android-100-weread')
})

test('parseBalance 解析真实回包的 balance / giftBalance / expiryBalance', () => {
    assert.deepEqual(parseBalance(sample), { balance: 16.6, giftBalance: 16.6, expiryBalance: 0 })
    assert.deepEqual(parseBalance({ balance: 16.6, giftBalance: 16.6, expiryBalance: 2.5 }), { balance: 16.6, giftBalance: 16.6, expiryBalance: 2.5 })
})

test('parseBalance 缺字段给 0', () => {
    assert.deepEqual(parseBalance({ balance: 3 }), { balance: 3, giftBalance: 0, expiryBalance: 0 })
    assert.deepEqual(parseBalance({}), { balance: 0, giftBalance: 0, expiryBalance: 0 })
})

test('parseBalance 字符串数字转成数字', () => {
    assert.deepEqual(parseBalance({ balance: '16.60', giftBalance: '1.20', expiryBalance: '0.50' }), { balance: 16.6, giftBalance: 1.2, expiryBalance: 0.5 })
})

test('parseBalance 对 null / 非对象 / 非数字字段安全', () => {
    const zero = { balance: 0, giftBalance: 0, expiryBalance: 0 }
    assert.deepEqual(parseBalance(null), zero)
    assert.deepEqual(parseBalance(undefined), zero)
    assert.deepEqual(parseBalance('<html>'), zero)
    assert.deepEqual(parseBalance({ balance: 'x', giftBalance: null }), zero)
})

test('readBalance POST 到 /pay/balance,带 content-type 与 pf', async () => {
    const sink = {}
    const result = await readBalance({ token: { vid: 1, accessToken: 'x' }, fetchImpl: fetchCapturing(JSON.stringify(sample), 200, sink) })

    assert.equal(result.ok, true)
    assert.equal(result.balance, 16.6)
    assert.equal(result.giftBalance, 16.6)
    assert.equal(result.expiryBalance, 0)
    assert.equal(result.reason, null)
    assert.equal(result.raw.status, 200)

    assert.equal(sink.url, 'https://i.weread.qq.com/pay/balance')
    assert.equal(sink.options.method, 'POST')
    assert.match(sink.options.headers['content-type'], /application\/json/)
    assert.equal(sink.options.headers.accessToken, 'x')
    assert.deepEqual(JSON.parse(sink.options.body), { pf: CLIENT_PF })
})

test('readBalance 业务错误码 499 -2003 视为失败', async () => {
    const result = await readBalance({ token: {}, fetchImpl: fetchCapturing('{"errcode":-2003}', 499) })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'query-failed')
    assert.equal(result.balance, 0)
    assert.equal(result.raw.status, 499)
})

test('readBalance 非 JSON 的 200 响应也返回 0 余额而不是抛错', async () => {
    const result = await readBalance({ token: {}, fetchImpl: fetchCapturing('<html>nope</html>') })
    assert.equal(result.ok, true)
    assert.equal(result.balance, 0)
    assert.equal(result.giftBalance, 0)
    assert.equal(result.expiryBalance, 0)
})

test('readBalance 网络异常返回失败对象而不是抛错', async () => {
    const result = await readBalance({ token: {}, fetchImpl: async () => { throw new Error('boom') } })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'query-failed')
    assert.equal(result.balance, 0)
    assert.equal(result.expiryBalance, 0)
    assert.equal(result.raw.status, 0)
    assert.equal(result.raw.error, 'boom')
})

test('readBalance 未传 ctx 时也不 reject', async () => {
    const result = await readBalance()
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'query-failed')
    assert.equal(result.balance, 0)
})
