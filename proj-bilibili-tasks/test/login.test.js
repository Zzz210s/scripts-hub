import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { runLogin, extractLink } from '../src/login.js'
import { loadConfig } from '../src/config.js'

const LINK = 'https://tool.lu/qrcode/basic.html?text=https%3A%2F%2Fpassport.bilibili.com%2Fqr%2Fabc'

const makeSpawn = (lines, code = 0) => () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => setImmediate(() => child.emit('close', null))
    setImmediate(() => {
        for (const line of lines) child.stdout.emit('data', `${line}\n`)
        child.emit('close', code)
    })
    return child
}

const hangSpawn = (lines) => () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => setImmediate(() => child.emit('close', null))
    setImmediate(() => { for (const line of lines) child.stdout.emit('data', `${line}\n`) })
    return child
}

const statefulCookie = (before, after) => { let n = 0; return () => (++n === 1 ? before : after) }

test('extractLink 抽取并去掉尾部标点', () => {
    assert.equal(extractLink(`块字符 ${LINK}`), LINK)
    assert.equal(extractLink(`${LINK},`), LINK)
    assert.equal(extractLink('没有链接'), null)
})

test('从 stdout 抽链接并立刻回调,拿到新 mid -> 成功', async () => {
    let seen = null
    const result = await runLogin({
        config: loadConfig({}),
        spawnImpl: makeSpawn(['二维码块字符', LINK], 0),
        readCookieImpl: statefulCookie(null, { mid: '998877' }),
        onLink: (link) => { seen = link }
    })
    assert.equal(seen, LINK)
    assert.equal(result.ok, true)
    assert.equal(result.mid, '998877')
    assert.equal(result.link, LINK)
})

test('没有新 mid(还是旧 mid)-> 失败', async () => {
    const result = await runLogin({
        config: loadConfig({}),
        spawnImpl: makeSpawn([LINK], 0),
        readCookieImpl: statefulCookie({ mid: '111' }, { mid: '111' })
    })
    assert.equal(result.ok, false)
    assert.ok(result.link)
    assert.equal(result.error, '没有拿到新的登录凭据')
})

test('日志里没有链接 -> 失败', async () => {
    const result = await runLogin({ config: loadConfig({}), spawnImpl: makeSpawn(['啥也没有'], 0), readCookieImpl: () => null })
    assert.equal(result.ok, false)
    assert.equal(result.error, '没有从日志里找到二维码链接')
})

test('超时被杀 -> 提示重跑', async () => {
    const result = await runLogin({
        config: loadConfig({}),
        timeoutMinutes: 0.02,
        spawnImpl: hangSpawn([LINK]),
        readCookieImpl: statefulCookie(null, { mid: '222' })
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, '登录超时,请重跑一次')
})
