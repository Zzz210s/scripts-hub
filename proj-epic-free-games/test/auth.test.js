// 续期编排:未过期不刷新、过期自动刷新并写回、吊销分类、网络退避、注入失败退化。全部注入,不联网。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureSession } from '../src/auth.js'
import { loadTokens, normalizeTokens, saveTokens } from '../src/tokens.js'

const NOW = new Date('2026-10-06T10:00:00Z')
const SERVER_ERROR = { errorCode: 'errors.com.epicgames.oauth.server', errorMessage: 'oops' }

function workspace(overrides = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-auth-'))
    const tokensFile = path.join(dir, 'secrets', 'epic-tokens.json')
    const config = { tokensFile, browserDir: path.join(dir, 'data', 'browser') }
    if (overrides.tokens) saveTokens(tokensFile, overrides.tokens)
    if (overrides.rawTokens) {
        fs.mkdirSync(path.dirname(tokensFile), { recursive: true })
        fs.writeFileSync(tokensFile, JSON.stringify(overrides.rawTokens))
    }
    if (overrides.badJson) {
        fs.mkdirSync(path.dirname(tokensFile), { recursive: true })
        fs.writeFileSync(tokensFile, '{not json')
    }
    return { config, tokensFile }
}

const response = (body, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) })
const expiring = (expiresAt, extra = {}) => normalizeTokens({ account_id: 'acc', access_token: 'eg1~old', refresh_token: 'eg1~refresh', expires_at: expiresAt, refresh_expires_at: '2026-11-01T00:00:00Z', ...extra }, NOW)

test('没有 token 文件时退回 profile,不联网', async () => {
    const { config } = workspace()
    let fetched = 0
    const result = await ensureSession({ config, now: NOW, fetchImpl: async () => { fetched++; return response({}) } })
    assert.equal(result.ok, true)
    assert.equal(result.mode, 'profile')
    assert.equal(fetched, 0)
})

test('access token 仍有效时不刷新,只注入', async () => {
    const tokens = expiring('2026-10-06T12:00:00Z')
    const { config } = workspace({ tokens })
    let fetched = 0
    let injected = null
    const result = await ensureSession({
        config, now: NOW,
        fetchImpl: async () => { fetched++; return response({}) },
        inject: async (args) => { injected = args; return { ok: true } }
    })
    assert.equal(result.mode, 'token')
    assert.equal(fetched, 0)
    assert.equal(injected.accessToken, 'eg1~old')
})

test('快过期时自动刷新并写回文件', async () => {
    const { config, tokensFile } = workspace({ tokens: expiring('2026-10-06T10:02:00Z') })
    const fresh = { access_token: 'eg1~new', refresh_token: 'eg1~refresh2', expires_at: '2026-10-06T14:00:00Z', refresh_expires_at: '2026-11-02T00:00:00Z', account_id: 'acc' }
    const result = await ensureSession({ config, now: NOW, fetchImpl: async () => response(fresh), inject: async () => ({ ok: true }) })
    assert.equal(result.mode, 'refreshed')
    assert.equal(result.tokens.accessToken, 'eg1~new')
    const saved = loadTokens(tokensFile)
    assert.equal(saved.tokens.accessToken, 'eg1~new')
    assert.equal(saved.tokens.refreshToken, 'eg1~refresh2')
})

test('refresh 被吊销只试一次并标记需要人工登录', async () => {
    const { config } = workspace({ tokens: expiring('2026-10-06T09:00:00Z') })
    let fetched = 0
    const result = await ensureSession({
        config, now: NOW,
        fetchImpl: async () => { fetched++; return response({ errorCode: 'errors.com.epicgames.account.auth_token.invalid_refresh_token' }, 400) },
        inject: async () => ({ ok: true })
    })
    assert.equal(result.ok, false)
    assert.equal(result.needsLogin, true)
    assert.equal(fetched, 1)
})

test('网络异常按退避重试后如实失败', async () => {
    const { config } = workspace({ tokens: expiring('2026-10-06T09:00:00Z') })
    let fetched = 0
    const waits = []
    const result = await ensureSession({
        config, now: NOW,
        fetchImpl: async () => { fetched++; return response(SERVER_ERROR, 503) },
        sleep: async (ms) => { waits.push(ms) },
        inject: async () => ({ ok: true }),
        retries: 2
    })
    assert.equal(result.ok, false)
    assert.equal(result.network, true)
    assert.equal(result.needsLogin, false)
    assert.equal(fetched, 3)
    assert.deepEqual(waits, [1000, 2000])
})

test('注入失败退化为 profile 但仍算成功', async () => {
    const { config } = workspace({ tokens: expiring('2026-10-06T12:00:00Z') })
    const result = await ensureSession({ config, now: NOW, inject: async () => ({ ok: false, error: 'no chromium' }) })
    assert.equal(result.ok, true)
    assert.equal(result.injected, false)
    assert.match(result.warn, /no chromium/)
})

test('无 refresh_token 且已过期时要求重新登录', async () => {
    const { config } = workspace({ tokens: normalizeTokens({ access_token: 'eg1~old', expires_at: '2026-10-06T09:00:00Z' }, NOW) })
    const result = await ensureSession({ config, now: NOW })
    assert.equal(result.ok, false)
    assert.equal(result.needsLogin, true)
})

test('文件里没有 token 时退回 profile', async () => {
    const { config } = workspace({ rawTokens: { broken: true } })
    const result = await ensureSession({ config, now: NOW })
    assert.equal(result.ok, true)
    assert.equal(result.mode, 'profile')
})

test('坏 token 文件退回 profile 而不是崩', async () => {
    const { config } = workspace({ badJson: true })
    const result = await ensureSession({ config, now: NOW })
    assert.equal(result.ok, true)
    assert.equal(result.mode, 'profile')
    assert.match(result.warn, /不是合法 JSON/)
})
