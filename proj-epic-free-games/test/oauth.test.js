// OAuth 客户端:只验证请求形态与失败分类,全部用注入的 fetch 桩,不联网。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    DEVICE_CLIENT,
    EpicAuthError,
    OAUTH_DEVICE_URL,
    OAUTH_TOKEN_URL,
    classifyAuthFailure,
    exchangeDeviceCode,
    getClientCredentialsToken,
    refreshAccessToken,
    requestDeviceAuthorization
} from '../src/oauth.js'

const jsonResponse = (body, { status = 200 } = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
})

function capture(response) {
    const calls = []
    const fetchImpl = async (url, init) => {
        calls.push({ url: String(url), init })
        return typeof response === 'function' ? response() : response
    }
    return { fetchImpl, calls }
}

const bodyOf = (call) => new URLSearchParams(call.init.body)
const basicOf = (call) => Buffer.from(String(call.init.headers.authorization).replace(/^basic /i, ''), 'base64').toString('utf8')

test('client_credentials 带 basic 头与 grant_type', async () => {
    const { fetchImpl, calls } = capture(jsonResponse({ access_token: 'cc-token' }))
    const out = await getClientCredentialsToken({ fetchImpl })
    assert.equal(out.access_token, 'cc-token')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, OAUTH_TOKEN_URL)
    assert.equal(bodyOf(calls[0]).get('grant_type'), 'client_credentials')
    assert.equal(bodyOf(calls[0]).get('token_type'), 'eg1')
    assert.equal(basicOf(calls[0]), `${DEVICE_CLIENT.id}:${DEVICE_CLIENT.secret}`)
})

test('deviceAuthorization 走 Bearer 且带 prompt=login', async () => {
    const payload = { user_code: 'ABCD', device_code: 'dev-1', verification_uri_complete: 'https://epic/activate', expires_in: 300, interval: 5 }
    const { fetchImpl, calls } = capture(jsonResponse(payload))
    const out = await requestDeviceAuthorization({ bearer: 'cc-token', fetchImpl })
    assert.equal(out.device_code, 'dev-1')
    assert.ok(calls[0].url.startsWith(OAUTH_DEVICE_URL))
    assert.match(calls[0].url, /prompt=login/)
    assert.equal(calls[0].init.headers.authorization, 'Bearer cc-token')
})

test('device_code 与 refresh_token 授权形态', async () => {
    const device = capture(jsonResponse({ access_token: 'a' }))
    await exchangeDeviceCode({ deviceCode: 'dev-1', fetchImpl: device.fetchImpl })
    assert.equal(bodyOf(device.calls[0]).get('grant_type'), 'device_code')
    assert.equal(bodyOf(device.calls[0]).get('device_code'), 'dev-1')

    const refresh = capture(jsonResponse({ access_token: 'b' }))
    await refreshAccessToken({ refreshToken: 'rt-1', fetchImpl: refresh.fetchImpl })
    assert.equal(bodyOf(refresh.calls[0]).get('grant_type'), 'refresh_token')
    assert.equal(bodyOf(refresh.calls[0]).get('refresh_token'), 'rt-1')
})

test('失败分类覆盖吊销、网络、待授权与其它拒绝', () => {
    assert.equal(classifyAuthFailure({ status: 400, errorCode: 'errors.com.epicgames.account.oauth.authorization_pending' }), 'pending')
    assert.equal(classifyAuthFailure({ status: 400, errorCode: 'errors.com.epicgames.account.auth_token.invalid_refresh_token' }), 'revoked')
    assert.equal(classifyAuthFailure({ status: 401 }), 'revoked')
    assert.equal(classifyAuthFailure({ status: 500 }), 'network')
    assert.equal(classifyAuthFailure({ error: new Error('boom') }), 'network')
    assert.equal(classifyAuthFailure({ status: 400, errorCode: 'errors.com.epicgames.oauth.whatever' }), 'invalid')
})

test('HTTP 400 带 invalid_refresh_token 抛 revoked', async () => {
    const { fetchImpl } = capture(jsonResponse({ errorCode: 'errors.com.epicgames.account.auth_token.invalid_refresh_token', errorMessage: 'invalid' }, { status: 400 }))
    await assert.rejects(() => refreshAccessToken({ refreshToken: 'rt', fetchImpl }), (error) => {
        assert.ok(error instanceof EpicAuthError)
        assert.equal(error.kind, 'revoked')
        return true
    })
})

test('网络异常归为 network,不被吞成普通错误', async () => {
    const fetchImpl = async () => { throw new Error('socket hang up') }
    await assert.rejects(() => refreshAccessToken({ refreshToken: 'rt', fetchImpl }), (error) => {
        assert.equal(error.kind, 'network')
        return true
    })
})
