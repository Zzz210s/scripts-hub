// 文案:四条消息的形状与硬规则(不用圆括号、不用 emoji、` · ` 分隔、标题四段)。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStartMessage, buildResultMessage, buildSkipMessage, buildActionMessage, PROGRAM, STATUS_TEXT } from '../src/messages.js'
import { truncateText } from '../src/notify.js'

const DATE = '2026-10-06'
const END = new Date('2026-10-08T15:00:00Z')
const GAME = { slug: 'system-shock-2', title: 'System Shock 2: 25th Anniversary Remaster', status: 'claimed', originalPrice: '¥76', endAt: END }

const shapes = () => [
    ['start', buildStartMessage({ date: DATE })],
    ['result-ok', buildResultMessage({ date: DATE, games: [GAME] })],
    ['result-failed', buildResultMessage({ date: DATE, games: [{ ...GAME, status: 'failed' }] })],
    ['skip', buildSkipMessage({ date: DATE, reason: 'nothing-new' })],
    ['action', buildActionMessage({ date: DATE, kind: 'captcha', items: [{ title: GAME.title, checkout: 'https://www.epicgames.com/store/purchase?offers=1-ns-oid', endAt: END }] })]
]

test('四条消息都不带圆括号、不带 emoji', () => {
    for (const [name, text] of shapes()) {
        assert.doesNotMatch(text, /[()（）]/, `${name} 不该有圆括号`)
        assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u, `${name} 不该有 emoji`)
    }
})

test('标题行四段:程序名 / 账号或账号数 / 日期 / 动作', () => {
    for (const [name, text] of shapes()) {
        const [program, account, date, action] = text.split('\n')[0].split(' · ')
        assert.equal(program, PROGRAM, `${name} 第一段`)
        assert.equal(account, '1 个账号', `${name} 第二段`)
        assert.equal(date, DATE, `${name} 第三段`)
        assert.ok(action.length > 0, `${name} 第四段`)
    }
})

test('start 只有一行', () => {
    assert.equal(buildStartMessage({ date: DATE }), 'Epic 限免 · 1 个账号 · 2026-10-06 · 开始领取')
})

test('result 动作词随结论变,正文逐条一行并带截止时间', () => {
    const ok = buildResultMessage({ date: DATE, games: [GAME] })
    assert.match(ok, /运行成功/)
    assert.match(ok, /本期限免 1 个 · 截止 /)
    assert.match(ok, /已领取 System Shock 2: 25th Anniversary Remaster · 原价 ¥76/)
    const bad = buildResultMessage({ date: DATE, games: [{ ...GAME, status: 'failed', note: '结账被拒' }] })
    assert.match(bad, /运行有失败/)
    assert.match(bad, /未领取 System Shock 2/)
    assert.match(bad, /\n  原因:结账被拒/)
})

test('每个状态都有中文动作词', () => {
    for (const status of ['claimed', 'existed', 'failed', 'missing', 'unavailable', 'requires-base-game']) {
        assert.ok(STATUS_TEXT[status], `${status} 缺动作词`)
        assert.match(buildResultMessage({ date: DATE, games: [{ ...GAME, status }] }), new RegExp(STATUS_TEXT[status]))
    }
})

test('skip 三段固定,末行是 你需要做什么:不需要', () => {
    const text = buildSkipMessage({ date: DATE, reason: 'nothing-new' })
    assert.match(text, /正常跳过/)
    assert.match(text, /原因:本期限免已全部领过/)
    assert.match(text, /后续:下一次触发会再看/)
    assert.ok(text.trimEnd().endsWith('你需要做什么:不需要'))
})

test('action 正文首句是 请你:,并逐条给结账链接', () => {
    const text = buildActionMessage({
        date: DATE,
        kind: 'captcha',
        items: [
            { title: 'TerraScape', checkout: 'https://www.epicgames.com/store/purchase?offers=1-ns-oid', endAt: END },
            { title: '深埋之星', checkout: 'https://www.epicgames.com/store/purchase?offers=1-ns-oid2', endAt: END }
        ]
    })
    assert.match(text, /需要你处理/)
    const body = text.split('\n\n')[1]
    assert.ok(body.startsWith('请你:'), '正文第一句必须是 请你:')
    assert.match(text, /结账链接:https:\/\/www\.epicgames\.com\/store\/purchase\?offers=1-ns-oid · TerraScape/)
    assert.match(text, /结账链接:https:\/\/www\.epicgames\.com\/store\/purchase\?offers=1-ns-oid2 · 深埋之星/)
    assert.match(text, /不处理的后果:/)
})

test('login 型 action 不给结账链接', () => {
    const text = buildActionMessage({ date: DATE, kind: 'login', items: [{ title: 'TerraScape' }] })
    assert.match(text, /登录令牌已失效/)
    assert.doesNotMatch(text, /结账链接/)
})

test('多条游戏的结果消息经发送层截断后仍不超上限', () => {
    const games = Array.from({ length: 60 }, (_, i) => ({ ...GAME, slug: `g${i}`, title: `游戏 ${i} 号` }))
    const text = buildResultMessage({ date: DATE, games })
    assert.equal(Buffer.byteLength(truncateText(text), 'utf8') <= 2048, true)
})
