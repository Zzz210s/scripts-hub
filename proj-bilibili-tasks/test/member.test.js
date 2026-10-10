import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memberFromNav } from '../src/member.js'

const nav = (data) => ({ code: 0, data })
const tier = (m) => [m.tier, m.isVip, m.notLoggedIn]

test('vipStatus 0/1 x vipType 0/1/2 全组合', () => {
    assert.deepEqual(tier(memberFromNav(nav({ isLogin: true, vipStatus: 0, vipType: 0 }))), ['none', false, false])
    assert.deepEqual(tier(memberFromNav(nav({ isLogin: true, vipStatus: 0, vipType: 1 }))), ['none', false, false])
    assert.deepEqual(tier(memberFromNav(nav({ isLogin: true, vipStatus: 0, vipType: 2 }))), ['none', false, false])   // vipStatus 门控
    assert.deepEqual(tier(memberFromNav(nav({ isLogin: true, vipStatus: 1, vipType: 0 }))), ['none', false, false])
    assert.deepEqual(tier(memberFromNav(nav({ isLogin: true, vipStatus: 1, vipType: 1 }))), ['monthly', true, false])
    assert.deepEqual(tier(memberFromNav(nav({ isLogin: true, vipStatus: 1, vipType: 2 }))), ['annual', true, false])
})

test('未登录', () => {
    assert.deepEqual(tier(memberFromNav(nav({ isLogin: false, vipStatus: 1, vipType: 2 }))), ['none', false, true])
})

test('缺字段不抛', () => {
    assert.doesNotThrow(() => memberFromNav(undefined))
    assert.deepEqual(tier(memberFromNav({})), ['none', false, true])
    assert.deepEqual(tier(memberFromNav({ data: {} })), ['none', false, true])
})

test('附带字段:券余额 / 硬币 / 等级', () => {
    const m = memberFromNav(nav({ isLogin: true, vipStatus: 1, vipType: 2, money: 128, wallet: { coupon_balance: 5 }, level_info: { current_level: 6 } }))
    assert.equal(m.couponBalance, 5)
    assert.equal(m.money, 128)
    assert.equal(m.level, 6)
})
