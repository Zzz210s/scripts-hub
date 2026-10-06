// 会话注入:cookie 组装与持久化 profile 写入。启动器是注入的桩,不真起浏览器。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BEARER_COOKIE, INJECT_DOMAINS, buildBearerCookies, injectSession, oversizedReason } from '../src/inject.js'

const TOKEN = 'eg1~abcdefghijklmnopqrstuvwxyz'
const EXPIRES = '2026-10-06T12:00:00Z'

test('cookie 组装:名字、取值、域与安全属性', () => {
    const cookies = buildBearerCookies(TOKEN, EXPIRES)
    assert.equal(cookies.length, INJECT_DOMAINS.length)
    for (const cookie of cookies) {
        assert.equal(cookie.name, BEARER_COOKIE)
        assert.equal(cookie.value, TOKEN)
        assert.ok(INJECT_DOMAINS.includes(cookie.domain))
        assert.equal(cookie.path, '/')
        assert.equal(cookie.secure, true)
        assert.equal(cookie.httpOnly, true)
        assert.equal(cookie.sameSite, 'Lax')
        assert.equal(cookie.expires, Math.floor(Date.parse(EXPIRES) / 1000))
    }
})

test('注入成功后关闭上下文', async () => {
    let added = null
    let closed = false
    const launch = async (dir, options) => {
        assert.ok(dir.endsWith('browser'))
        assert.equal(options.headless, true)
        return { addCookies: async (cookies) => { added = cookies }, close: async () => { closed = true } }
    }
    const result = await injectSession({ browserDir: '/tmp/profile/browser', accessToken: TOKEN, expiresAt: EXPIRES, launch })
    assert.equal(result.ok, true)
    assert.equal(added.length, INJECT_DOMAINS.length)
    assert.equal(closed, true)
})

test('注入失败不抛,返回错误并仍然关闭', async () => {
    let closed = false
    const launch = async () => ({ addCookies: async () => { throw new Error('locked') }, close: async () => { closed = true } })
    const result = await injectSession({ browserDir: '/tmp/profile/browser', accessToken: TOKEN, expiresAt: EXPIRES, launch })
    assert.equal(result.ok, false)
    assert.match(result.error, /locked/)
    assert.equal(closed, true)
})

test('缺少 token 或目录时直接失败', async () => {
    assert.equal((await injectSession({ browserDir: '/x', accessToken: '' })).ok, false)
    assert.equal((await injectSession({ accessToken: TOKEN })).ok, false)
})

test('超过浏览器 cookie 上限的 token:主动跳过并说明原因(不报成注入失败)', () => {
    // 2026-10-06 实测:value 4096 字节就报 Storage.setCookies: Invalid cookie fields,
    // 4000 字节才成功;而 Epic 的 access token 是 4529 字节 —— 这条路对它不成立。
    const reason = oversizedReason('x'.repeat(4529))
    assert.ok(reason, '4529 字节应当被判为放不下')
    assert.match(reason, /4529 字节/)
    assert.equal(oversizedReason('x'.repeat(4000)), null)
    assert.equal(oversizedReason('eg1~短token'), null)
})

test('放不下的 token:injectSession 不启动浏览器,直接返回 skipped', async () => {
    let launched = 0
    const result = await injectSession({
        browserDir: '/tmp/x',
        accessToken: 'x'.repeat(4529),
        launch: async () => { launched++; return { addCookies: async () => {}, close: async () => {} } }
    })
    assert.equal(launched, 0, '值太大就别开浏览器了')
    assert.equal(result.ok, false)
    assert.equal(result.skipped, true)
    assert.match(result.error, /cookie 上限/)
})
