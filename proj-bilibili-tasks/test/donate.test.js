import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coinTarget } from '../src/donate.js'

test('balance <= 0 -> balance-zero', () => {
    assert.deepEqual(coinTarget({ balance: 0, threshold: 20 }), { target: 0, stop: true, reason: 'balance-zero' })
    assert.equal(coinTarget({ balance: -1, threshold: 20 }).stop, true)
})

test('balance <= threshold -> below-threshold', () => {
    assert.deepEqual(coinTarget({ balance: 20, threshold: 20 }), { target: 0, stop: true, reason: 'below-threshold' })
    assert.equal(coinTarget({ balance: 5, threshold: 20 }).reason, 'below-threshold')
})

test('threshold+1 -> target 1', () => {
    assert.equal(coinTarget({ balance: 21, threshold: 20 }).target, 1)
})

test('余额很大时封顶 max', () => {
    assert.equal(coinTarget({ balance: 100, threshold: 20 }).target, 5)
    assert.equal(coinTarget({ balance: 100, threshold: 20, max: 3 }).target, 3)
})

test('threshold=0 等价上游默认行为', () => {
    assert.equal(coinTarget({ balance: 1, threshold: 0 }).target, 1)
    assert.equal(coinTarget({ balance: 10, threshold: 0 }).target, 5)
    assert.equal(coinTarget({ balance: 0, threshold: 0 }).stop, true)
})

test('默认 threshold=0 max=5;余额取不到按不可投', () => {
    assert.equal(coinTarget({ balance: 30 }).target, 5)
    assert.equal(coinTarget({ balance: NaN, threshold: 20 }).stop, true)
    assert.equal(coinTarget({}).stop, true)
})
