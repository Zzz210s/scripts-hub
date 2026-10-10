import { test } from 'node:test'
import assert from 'node:assert/strict'
import { voucherDecision } from '../src/voucher.js'

const my = (list) => ({ code: 0, data: { list } })

test('state 0/1/2/未知', () => {
    assert.equal(voucherDecision(my([{ type: 1, state: 0 }])).shouldReceive, true)
    assert.equal(voucherDecision(my([{ type: 1, state: 1 }])).shouldReceive, false)
    assert.equal(voucherDecision(my([{ type: 1, state: 2 }])).shouldReceive, true)
    assert.equal(voucherDecision(my([{ type: 1, state: 3 }])).shouldReceive, false)   // 未知值不领
})

test('已领取标记与 count', () => {
    const d = voucherDecision(my([{ type: 1, state: 1 }]))
    assert.equal(d.alreadyReceived, true)
    assert.equal(d.count, 0)
    assert.equal(d.state, 1)
})

test('list 为空 / 没有 type 1 / 非对象', () => {
    assert.equal(voucherDecision(my([])).count, 0)
    assert.equal(voucherDecision(my([])).shouldReceive, false)
    assert.equal(voucherDecision(my([{ type: 2, state: 0 }])).shouldReceive, false)
    assert.equal(voucherDecision({}).count, 0)
    assert.equal(voucherDecision(undefined).alreadyReceived, false)
})

test('多项取第一条的 state,count 是可领张数', () => {
    const d = voucherDecision(my([
        { type: 1, state: 0, next_receive_days: 0, expire_time: 123 },
        { type: 1, state: 1 },
        { type: 1, state: 2 }
    ]))
    assert.equal(d.state, 0)
    assert.equal(d.count, 2)
    assert.equal(d.shouldReceive, true)
    assert.equal(d.nextReceiveDays, 0)
    assert.equal(d.expireTime, 123)
})

test('state 未知但另有可领项时不领', () => {
    const d = voucherDecision(my([{ type: 1, state: 9 }, { type: 1, state: 0 }]))
    assert.equal(d.count, 2)
    assert.equal(d.shouldReceive, false)
})
