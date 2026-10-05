// 跳过与需要人工处理的原因词表:哪些静音(只写日志)、哪些要推、文案怎么写。
// 与 docs/notification-convention.md 的静音表同源:不需要人做任何事的那种只写日志。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REASONS, isSilentSkip, reasonText, followUpText, ACTION_KINDS, actionText } from '../src/policy.js'

test('静音表:所有正常跳过都只写日志(2026-10-05 用户要求)', () => {
    // 企业微信只收「需要你处理」;跳过不论原因都不推送,文案留在运行日志里
    for (const reason of Object.keys(REASONS)) {
        assert.equal(isSilentSkip(reason), true, `${reason} 应静音`)
        assert.equal(REASONS[reason].silent, true, `${reason} 的 silent 字段应为 true`)
    }
})

test('未知原因也静音、不抛,且有人话文案', () => {
    assert.equal(isSilentSkip('未定义的原因'), true)
    assert.equal(reasonText('未定义的原因'), '未定义的原因')
    assert.equal(followUpText('未定义的原因'), '下一次触发会再看')
})

test('每个原因都有人话文案与后续说明,且都定位在表里', () => {
    for (const [reason, entry] of Object.entries(REASONS)) {
        assert.equal(typeof entry.silent, 'boolean', `${reason} 缺 silent`)
        assert.ok(entry.text.length > 0, `${reason} 缺 text`)
        assert.ok(entry.followUp.length > 0, `${reason} 缺 followUp`)
        assert.equal(isSilentSkip(reason), entry.silent)
    }
})

test('需要人工处理的两种情形都有 请你 / 原因 / 后果 三段话', () => {
    for (const [kind, entry] of Object.entries(ACTION_KINDS)) {
        assert.ok(entry.please.startsWith('请你:'), `${kind} 的 please 必须以 请你: 开头`)
        assert.ok(entry.reason.length > 0, `${kind} 缺 reason`)
        assert.ok(entry.consequence.length > 0, `${kind} 缺 consequence`)
        assert.equal(actionText(kind).please, entry.please)
    }
})

test('未知的 action kind 退回 captcha 而不是崩', () => {
    assert.equal(actionText('???').please, ACTION_KINDS.captcha.please)
})
