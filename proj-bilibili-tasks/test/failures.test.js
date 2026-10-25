// 失败清单的组装:同一件事只说一遍(2026-10-25 真实消息里「352」与「投币未达标」是同一件事)。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFailures, isRateLimited } from '../src/failures.js'

const rateFailure = () => ({ kind: 'rate-limited', label: '临时风控拦截', note: 'B站 临时风控拦截 · 该接口稍后再试', ignored: true, retryable: true })
const classifyWith = (extra = {}) => ({ rateLimited: true, failures: [rateFailure(), ...(extra.failures ?? [])], ...extra })

test('投币未投出 + 当轮被风控拦过 -> 折叠成一句话,不再单独报风控', () => {
    const failures = buildFailures({ classify: classifyWith(), incomplete: ['coins'] })
    assert.equal(failures.length, 1, JSON.stringify(failures))
    assert.equal(failures[0].kind, 'incomplete')
    assert.equal(failures[0].note, '每日任务未完成 · 投币被 B站 临时风控拦截 · 下次触发会再试')
    assert.doesNotMatch(failures[0].note, /[（）()]/)
})

test('投币没问题时,风控那条单独保留(它解释了别的事为什么没做成)', () => {
    const failures = buildFailures({ classify: classifyWith(), incomplete: [] })
    assert.equal(failures.length, 1)
    assert.equal(failures[0].kind, 'rate-limited')
})

test('未达标的是观看而不是投币时,不折叠', () => {
    const failures = buildFailures({ classify: classifyWith(), incomplete: ['watch'] })
    const kinds = failures.map((f) => f.kind)
    assert.deepEqual(kinds, ['rate-limited', 'incomplete'])
    assert.equal(failures[1].note, '每日任务未完成 · 观看未达标')
})

test('多项未达标时保留全部项名', () => {
    const failures = buildFailures({ classify: { rateLimited: false, failures: [] }, incomplete: ['watch', 'coins'] })
    assert.equal(failures[0].note, '每日任务未完成 · 观看 投币未达标')
})

test('会员券的失败项原样并入,且不改动传进来的数组', () => {
    const classify = { rateLimited: false, failures: [rateFailure()] }
    const voucherFailure = { kind: 'voucher-no-csrf', label: '缺少 csrf', note: '会员券 · cookie 里没有 bili_jct · 未领取', ignored: true }
    const failures = buildFailures({ classify, incomplete: [], voucherFailure })
    assert.deepEqual(failures.map((f) => f.kind), ['rate-limited', 'voucher-no-csrf'])
    assert.equal(classify.failures.length, 1, '不能就地改调用方的数组')
})

test('没有失败时返回空数组', () => {
    assert.deepEqual(buildFailures({ classify: { failures: [] }, incomplete: [] }), [])
    assert.deepEqual(buildFailures({}), [])
})

test('isRateLimited 只认布尔真值', () => {
    assert.equal(isRateLimited({ rateLimited: true }), true)
    assert.equal(isRateLimited({ rateLimited: undefined }), false)
    assert.equal(isRateLimited(null), false)
})

// 折叠时不许把「投币之外」的缺失项吃掉(2026-10-25 自检发现:folded 分支只写了投币)
test('投币与观看同时未达标且被风控拦过时,两项都要出现在同一句里', () => {
    const failures = buildFailures({ classify: classifyWith(), incomplete: ['watch', 'coins'] })
    assert.equal(failures.length, 1, JSON.stringify(failures))
    assert.equal(failures[0].note, '每日任务未完成 · 观看未达标 · 投币被 B站 临时风控拦截 · 下次触发会再试')
})
