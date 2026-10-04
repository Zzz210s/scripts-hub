// 引擎结果归类:上游 lowdb 里的状态 + stdout 特征 -> 每条游戏的结论与是否需要人处理。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeRun, findGameStatus, accountName, detectCaptcha, detectLoginRequired } from '../src/classify.js'

const GAME = { slug: 'tomb-star', title: 'Tomb Star' }
const OTHER = { slug: 'system-shock-2', title: 'System Shock 2' }
const db = (entries) => ({ TestUser: entries })

test('上游状态映射到我们的结论', () => {
    const result = summarizeRun({ expected: [GAME], db: db({ 'tomb-star': { title: 'Tomb Star', status: 'claimed' } }), stdout: 'Claimed successfully!' })
    assert.deepEqual(result.games, [{ slug: 'tomb-star', title: 'Tomb Star', status: 'claimed', note: undefined }])
    assert.equal(result.ok, true)
})

test('已在库 / manual 都算拿到;本区不可领与需基础游戏算失败', () => {
    const cases = [
        ['existed', 'existed'],
        ['manual', 'existed'],
        ['unavailable-in-region', 'unavailable'],
        ['failed:requires-base-game', 'requires-base-game'],
        ['failed', 'failed'],
        ['skipped', 'missing']
    ]
    for (const [vendor, expected] of cases) {
        const result = summarizeRun({ expected: [GAME], db: db({ 'tomb-star': { status: vendor } }), stdout: '' })
        assert.equal(result.games[0].status, expected, `${vendor} -> ${expected}`)
        assert.equal(result.ok, expected === 'existed', `${vendor} 的是否成功`)
    }
})

test('引擎没走到这款游戏时算未领取', () => {
    const result = summarizeRun({ expected: [GAME, OTHER], db: db({ 'tomb-star': { status: 'claimed' } }), stdout: '' })
    assert.deepEqual(result.games.map((g) => g.status), ['claimed', 'missing'])
    assert.equal(result.ok, false)
})

test('stdout 里的 captcha / 登录失效会被识别,并翻译成原因', () => {
    const captcha = summarizeRun({ expected: [GAME], db: {}, stdout: '  Got hcaptcha challenge! Lost trust...', code: 0 })
    assert.equal(captcha.captcha, true)
    assert.equal(captcha.games[0].status, 'failed')
    assert.match(captcha.games[0].note, /hCaptcha/)
    const login = summarizeRun({ expected: [GAME], db: {}, stdout: 'Not signed in anymore. Please login in the browser or here in the terminal.', code: 1 })
    assert.equal(login.loginRequired, true)
    assert.match(login.games[0].note, /登录态/)
})

test('退出码非 0 且没有别的线索时,原因里带退出码', () => {
    const result = summarizeRun({ expected: [GAME], db: {}, stdout: '', code: 3 })
    assert.equal(result.games[0].status, 'missing')
    assert.match(result.games[0].note, /退出码 3/)
})

test('detectCaptcha / detectLoginRequired 认常见措辞', () => {
    assert.equal(detectCaptcha('h_captcha_challenge iframe'), true)
    assert.equal(detectCaptcha('captcha'), true)
    assert.equal(detectCaptcha('all good'), false)
    assert.equal(detectLoginRequired('Not signed in anymore'), true)
    assert.equal(detectLoginRequired('Signed in as TestUser'), false)
})

test('findGameStatus / accountName 从 lowdb 形状里取数', () => {
    assert.equal(findGameStatus(db({ 'tomb-star': { status: 'claimed' } }), 'tomb-star'), 'claimed')
    assert.equal(findGameStatus(db({}), 'nope'), null)
    assert.equal(findGameStatus(null, 'nope'), null)
    assert.equal(accountName(db({})), 'TestUser')
    assert.equal(accountName({}), '')
})
