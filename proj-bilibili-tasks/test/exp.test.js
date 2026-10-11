import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expFromReward, incompleteTasks } from '../src/exp.js'
import { renderExpLine } from '../src/messages.js'
import { computeExp } from '../src/classify.js'

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u
// 2026-10-11 真机实证值:login/watch 已完成,share 未完成,coins 已满 50
const REAL = { login: true, watch: true, coins: 50, share: false, email: true, tel: true, safe_question: false, identify_card: true }

test('expFromReward 用真值渲染,分享未完成不计入经验', () => {
    const view = expFromReward(REAL)
    assert.equal(view.login, '已得 5')
    assert.equal(view.watch, '已得 5')
    assert.equal(view.share, '未完成')
    assert.equal(view.coins, '已得 50')
    assert.equal(view.total, 60)
    assert.deepEqual(view.missing, ['share'])
    assert.equal(view.estimated, false)
})

test('expFromReward 四项全真 -> 65', () => {
    const view = expFromReward({ login: true, watch: true, share: true, coins: 50 })
    assert.equal(view.total, 65)
    assert.deepEqual(view.missing, [])
})

test('expFromReward coins 为 0 -> 未完成且不计分', () => {
    const view = expFromReward({ login: true, watch: false, share: false, coins: 0 })
    assert.equal(view.coins, '未完成')
    assert.equal(view.total, 5)
    assert.deepEqual(view.missing, ['watch', 'share', 'coins'])
})

test('expFromReward 字段缺失 -> 全部未完成', () => {
    const view = expFromReward({})
    assert.equal(view.total, 0)
    assert.deepEqual(view.missing, ['login', 'watch', 'share', 'coins'])
})

test('expFromReward 非对象/接口失败不崩', () => {
    assert.equal(expFromReward(null), null)
    assert.equal(expFromReward(undefined), null)
    assert.equal(expFromReward('boom'), null)
    assert.equal(expFromReward([]), null)
})

test('renderExpLine 真值行与估算回落标注', () => {
    const truth = renderExpLine(expFromReward(REAL))
    assert.equal(truth, '每日任务:登录 已得 5 · 观看 已得 5 · 分享 未完成 · 投币 已得 50 · 共 60 经验')
    const est = renderExpLine(computeExp({ classify: {}, target: 5 }))
    assert.ok(est.endsWith(' · 按计划口径估算'), est)
    assert.ok(!/[()（）]/.test(truth) && !/[()（）]/.test(est))
    assert.ok(!EMOJI.test(truth) && !EMOJI.test(est))
})

// R3:读回校验的完成度判定
test('incompleteTasks:share 未完成 -> 列出 share', () => {
    assert.deepEqual(incompleteTasks(expFromReward(REAL), { coinTarget: 5 }), ['share'])
})

test('incompleteTasks:四项全真 -> 无缺失', () => {
    const view = expFromReward({ login: true, watch: true, share: true, coins: 50 })
    assert.deepEqual(incompleteTasks(view, { coinTarget: 5 }), [])
})

test('incompleteTasks:投币目标 0 时不算缺失;目标 5 而经验不足才算', () => {
    const view = expFromReward({ login: true, watch: true, share: true, coins: 20 })
    assert.deepEqual(incompleteTasks(view, { coinTarget: 0 }), [])
    assert.deepEqual(incompleteTasks(view, { coinTarget: 5 }), ['coins'])
})

test('incompleteTasks:接口取不到时返回空,不因此判未完成', () => {
    assert.deepEqual(incompleteTasks(null, { coinTarget: 5 }), [])
})
