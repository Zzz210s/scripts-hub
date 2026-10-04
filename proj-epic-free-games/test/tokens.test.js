// token 存储:读写、过期判定、掩码。用到临时目录,不联网。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { accessTokenValid, loadTokens, maskToken, normalizeTokens, saveTokens, tokenSummary } from '../src/tokens.js'

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'epic-tokens-')), 'secrets', 'epic-tokens.json')
const NOW = new Date('2026-10-06T10:00:00Z')

test('文件不存在时返回空且不报错', () => {
    const { tokens, error } = loadTokens(tmpFile())
    assert.equal(tokens, null)
    assert.equal(error, null)
})

test('normalizeTokens 兼容 Epic 的 snake_case 响应', () => {
    const tokens = normalizeTokens({
        account_id: 'acc',
        displayName: 'player',
        client_id: 'cid',
        access_token: 'eg1~access',
        refresh_token: 'eg1~refresh',
        expires_at: '2026-10-06T12:00:00Z',
        refresh_expires_at: '2026-10-29T10:00:00Z'
    }, NOW)
    assert.equal(tokens.accountId, 'acc')
    assert.equal(tokens.displayName, 'player')
    assert.equal(tokens.accessToken, 'eg1~access')
    assert.equal(tokens.refreshToken, 'eg1~refresh')
    assert.equal(tokens.accessExpiresAt, '2026-10-06T12:00:00Z')
})

test('saveTokens 落盘并可原样读回', () => {
    const file = tmpFile()
    const tokens = normalizeTokens({ account_id: 'acc', access_token: 'eg1~a', refresh_token: 'eg1~r', expires_at: '2026-10-06T12:00:00Z' }, NOW)
    saveTokens(file, tokens)
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(raw.version, 1)
    assert.equal(raw.accessToken, 'eg1~a')
    const back = loadTokens(file)
    assert.equal(back.tokens.accessToken, 'eg1~a')
})

test('accessTokenValid 留出刷新余量', () => {
    const tokens = normalizeTokens({ access_token: 'x', expires_at: '2026-10-06T10:04:00Z' }, NOW)
    assert.equal(accessTokenValid(tokens, NOW, 5 * 60 * 1000), false) // 只剩 4 分钟,算过期
    const fresh = normalizeTokens({ access_token: 'x', expires_at: '2026-10-06T11:00:00Z' }, NOW)
    assert.equal(accessTokenValid(fresh, NOW, 5 * 60 * 1000), true)
    assert.equal(accessTokenValid(normalizeTokens({ access_token: 'x' }, NOW), NOW), false) // 无到期时间一律当过期
})

test('maskToken 不泄露完整 token', () => {
    const token = 'eg1~abcdefghijklmnopqrstuvwxyz'
    const masked = maskToken(token)
    assert.ok(!masked.includes(token))
    assert.match(masked, /^eg1~ab\.\.\./)
    assert.equal(maskToken('short'), '****')
    assert.equal(maskToken(''), '')
})

test('tokenSummary 给出账号与到期状态', () => {
    const tokens = normalizeTokens({ account_id: 'acc', displayName: 'player', access_token: 'eg1~a', refresh_token: 'eg1~r', expires_at: '2026-10-06T12:00:00Z' }, NOW)
    const summary = tokenSummary(tokens, NOW)
    assert.equal(summary.account, 'player')
    assert.equal(summary.accessValid, true)
    assert.equal(summary.hasRefresh, true)
    assert.ok(!summary.masked.includes('eg1~a'))
})
