import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyRun, detectFeatures, computeExp } from '../src/classify.js'

test('-403 需要同行关键词;裸 -403 不命中', () => {
    assert.equal(classifyRun({ exitCode: 0, stdout: '投币失败 -403 账号异常' }).risk403, true)
    assert.equal(classifyRun({ exitCode: 0, stdout: '余额 128.0 aid=403123' }).risk403, false)
    assert.equal(classifyRun({ exitCode: 0, stdout: '-403' }).risk403, false)
})

test('352 需要同行关键词;裸数字不命中', () => {
    assert.equal(classifyRun({ exitCode: 0, stdout: '观看失败 352' }).task352, true)
    assert.equal(classifyRun({ exitCode: 0, stdout: '耗时 1352 ms' }).task352, false)
    assert.equal(classifyRun({ exitCode: 0, stdout: '352' }).task352, false)
})

test('6007000 -> bigPointFlaky 且不计入成败', () => {
    const r = classifyRun({ exitCode: 0, stdout: '大积分 receive/v2 返回 6007000 请将客户端更新至最新版本' })
    assert.equal(r.bigPointFlaky, true)
    assert.equal(r.ok, true)
    assert.equal(r.failures.filter((f) => !f.ignored).length, 0)
})

test('69801 -> voucherTaken 不算失败', () => {
    const r = classifyRun({ exitCode: 0, stdout: '69801 你已领取过该权益' })
    assert.equal(r.voucherTaken, true)
    assert.equal(r.ok, true)
    assert.equal(r.failures.length, 0)
})

test('cookieInvalid 中英文特征', () => {
    assert.equal(classifyRun({ exitCode: 0, stdout: '账号未登录' }).cookieInvalid, true)
    assert.equal(classifyRun({ exitCode: 0, stdout: 'please login required' }).cookieInvalid, true)
})

test('分享失败与观看失败', () => {
    assert.equal(classifyRun({ exitCode: 0, stdout: '分享被风控拒绝' }).shareFailed, true)
    assert.equal(classifyRun({ exitCode: 0, stdout: '观看视频失败' }).watchFailed, true)
})

test('超时按可重试失败处理', () => {
    const r = classifyRun({ exitCode: null, timedOut: true })
    assert.equal(r.timedOut, true)
    assert.equal(r.ok, false)
    assert.ok(r.failures.some((f) => f.kind === 'timeout'))
})

test('退出码 0 -> ok;退出码 1 无特征 -> 失败', () => {
    assert.equal(classifyRun({ exitCode: 0, stdout: '一切正常' }).ok, true)
    const r = classifyRun({ exitCode: 1, stdout: '一切正常' })
    assert.equal(r.ok, false)
    assert.ok(r.failures.length >= 1)
})

test('detectFeatures 逐行匹配', () => {
    const hit = detectFeatures('第一行正常\n第二行 分享 -403 风控\n第三行正常')
    assert.ok(hit.risk403.includes('-403'))
})

test('computeExp 自己算经验', () => {
    assert.deepEqual(computeExp({ classify: { ok: true }, target: 5 }), { login: '5', watch: '5', share: '5', coin: '50', total: 65 })
    const failed = computeExp({ classify: { shareFailed: true }, target: 5 })
    assert.equal(failed.share, '分享失败')
    assert.equal(failed.total, 60)
    assert.equal(computeExp({ classify: {}, target: 0 }).coin, '跳过')
    assert.equal(computeExp({ classify: { cookieInvalid: true }, target: 0 }).login, '失败')
})
