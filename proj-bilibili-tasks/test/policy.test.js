import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REASONS, isSilentSkip, reasonText, followUpText, ACTION_KINDS, actionText } from '../src/policy.js'

test('isSilentSkip 对已知与未知原因都返回 true', () => {
    for (const reason of ['paused', 'done-today', 'attempts-exhausted', 'peer-running', 'quiet-hours', 'before-shutdown', 'low-memory', 'no-credentials', 'whatever']) {
        assert.equal(isSilentSkip(reason), true)
    }
})

test('REASONS 覆盖七个守卫原因 + no-credentials', () => {
    for (const reason of ['paused', 'done-today', 'attempts-exhausted', 'peer-running', 'quiet-hours', 'before-shutdown', 'low-memory', 'no-credentials']) {
        assert.ok(REASONS[reason]?.text, reason)
        assert.ok(REASONS[reason]?.followUp, reason)
    }
})

test('ACTION_KINDS 三个 kind 都有三段且不含圆括号', () => {
    for (const kind of ['login', 'cookie-invalid', 'risk-blocked']) {
        const entry = ACTION_KINDS[kind]
        assert.ok(entry.please && entry.reason && entry.consequence, kind)
        assert.ok(!/[()（）]/.test(entry.please + entry.reason + entry.consequence), kind)
    }
})

test('actionText 回落与文案查找', () => {
    assert.equal(actionText('nope').please, ACTION_KINDS['cookie-invalid'].please)
    assert.equal(reasonText('done-today'), '今天已经成功跑过一次')
    assert.equal(reasonText('未知'), '未知')
    assert.equal(followUpText('未知'), '下一次触发会再看')
})
