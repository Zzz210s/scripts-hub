// 设备授权登录:轮询 shape、成功落盘、超时。全部注入,不联网、不启浏览器。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deviceLogin, profileLogin } from '../src/login.js'
import { loadTokens } from '../src/tokens.js'

const NOW = new Date('2026-10-06T10:00:00Z')
const DEVICE = { user_code: 'WXYZ-1234', device_code: 'dev-1', verification_uri_complete: 'https://www.epicgames.com/id/activate?userCode=WXYZ-1234', expires_in: 300, interval: 5 }
const SESSION = { account_id: 'acc', displayName: 'player', access_token: 'eg1~access', refresh_token: 'eg1~refresh', expires_at: '2026-10-06T12:00:00Z', refresh_expires_at: '2026-10-29T00:00:00Z' }

const response = (body, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) })
const worksapce = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-login-'))
    return { config: { tokensFile: path.join(dir, 'secrets', 'epic-tokens.json') }, tokensFile: path.join(dir, 'secrets', 'epic-tokens.json') }
}

// 每次调用按顺序弹出一个响应;授权未完成用 authorization_pending 表达。
function sequence(responses) {
    let i = 0
    return async () => responses[Math.min(i++, responses.length - 1)]
}

test('设备授权:打印链接与验证码,轮询成功后落盘', async () => {
    const { config, tokensFile } = worksapce()
    const lines = []
    const fetchImpl = sequence([
        response({ access_token: 'cc-token' }),
        response(DEVICE),
        response({ errorCode: 'errors.com.epicgames.account.oauth.authorization_pending' }, 400),
        response(SESSION)
    ])
    const result = await deviceLogin({ config, now: NOW, fetchImpl, sleep: async () => {}, log: (line) => lines.push(line), pollIntervalMs: 1 })
    assert.equal(result.ok, true)
    assert.match(lines.join('\n'), /epicgames\.com\/id\/activate/)
    assert.match(lines.join('\n'), /WXYZ-1234/)
    const saved = loadTokens(tokensFile)
    assert.equal(saved.tokens.accessToken, 'eg1~access')
    assert.equal(saved.tokens.refreshToken, 'eg1~refresh')
})

test('设备授权:超时就报错,不无限轮询', async () => {
    const { config } = worksapce()
    let t = 0
    const fetchImpl = sequence([
        response({ access_token: 'cc-token' }),
        response(DEVICE),
        response({ errorCode: 'errors.com.epicgames.account.oauth.authorization_pending' }, 400)
    ])
    const result = await deviceLogin({
        config, now: NOW, fetchImpl, pollIntervalMs: 1,
        clock: () => t,
        sleep: async (ms) => { t += ms > 0 ? 10_000 : 0 },
        timeoutMs: 100,
        log: () => {}
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /超时/)
})

test('profile 退路仍走浏览器登录', async () => {
    const { config } = worksapce()
    const seen = []
    const result = await profileLogin({ config, runEngine: async (args) => { seen.push(args); return { code: 0 } }, log: () => {} })
    assert.equal(result.ok, true)
    assert.equal(seen[0].env.NOWAIT, '')
    assert.equal(seen[0].env.LOGIN_TIMEOUT, '600')
})
