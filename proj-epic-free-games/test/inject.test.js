// 会话注入:cookie 组装与持久化 profile 写入。启动器是注入的桩,不真起浏览器。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BEARER_COOKIE, INJECT_DOMAINS, buildBearerCookies, injectSession } from '../src/inject.js'

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
