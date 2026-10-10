import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROGRAM, buildStartMessage, buildResultMessage, buildSkipMessage, buildActionMessage, renderDonateLine, renderVoucherLine } from '../src/messages.js'

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

test('四条消息都不含圆括号与 emoji', () => {
    const messages = [
        buildStartMessage({ date: '2026-10-11' }),
        buildResultMessage({ date: '2026-10-11', exp: { login: '5', watch: '5', share: '5', coin: '50', total: 65 }, donate: { target: 5, stop: false, balance: 128 }, voucher: { action: 'received', count: 1, balance: 5, nextReceiveDays: 31 }, manga: 'ok' }),
        buildSkipMessage({ date: '2026-10-11', reason: 'done-today' }),
        buildActionMessage({ date: '2026-10-11', kind: 'cookie-invalid' })
    ]
    for (const text of messages) {
        assert.ok(!/[()（）]/.test(text), `圆括号:${text}`)
        assert.ok(!EMOJI.test(text), `emoji:${text}`)
    }
})

test('标题四段且以 · 分隔', () => {
    const first = buildStartMessage({ date: '2026-10-11' }).split('\n')[0]
    assert.deepEqual(first.split(' · '), [PROGRAM, '1 个账号', '2026-10-11', '开始运行'])
})

test('result 成功/有失败的动作词与原因缩进', () => {
    const base = { date: '2026-10-11', exp: { login: '5', watch: '5', share: '5', coin: '50', total: 65 }, donate: { target: 5, stop: false, balance: 128 }, voucher: { action: 'received', count: 1 } }
    assert.ok(buildResultMessage({ ...base, ok: true }).includes(' · 运行成功'))
    const failed = buildResultMessage({ ...base, ok: false, failures: [{ note: '分享被风控拒绝 · 账号级风控 · 会自行过期' }] })
    assert.ok(failed.startsWith(`${PROGRAM} · 1 个账号 · 2026-10-11 · 运行有失败`))
    assert.ok(failed.includes('\n  原因:分享被风控拒绝'))
})

test('action 正文首行是 请你: 且含后果', () => {
    const text = buildActionMessage({ date: '2026-10-11', kind: 'cookie-invalid' })
    assert.equal(text.split('\n')[2], '请你:在跑这个程序的机器上重新扫码登录一次')
    assert.ok(text.includes('不处理的后果:'))
})

test('投币行按设计文档 §8.4', () => {
    assert.equal(renderDonateLine({ stop: true, reason: 'balance-zero' }), '投币:跳过 · 硬币余额为 0')
    assert.equal(renderDonateLine({ stop: true, reason: 'below-threshold', threshold: 20 }), '投币:跳过 · 硬币余额不高于保留值 20')
    assert.equal(renderDonateLine({ stop: true, reason: 'no-followings' }), '投币:跳过 · 关注列表为空')
    assert.equal(renderDonateLine({ stop: true, reason: 'unknown-followings' }), '投币:跳过 · 无法确认关注列表')
    assert.equal(renderDonateLine({ stop: true, reason: 'no-balance' }), '投币:跳过 · 未取到硬币余额')
    assert.equal(renderDonateLine({ target: 5, stop: false, balance: 128 }), '投币:5 枚 · 投给关注的 UP · 余额 128.0')
})

test('会员券行', () => {
    assert.equal(renderVoucherLine({ action: 'received', count: 1, balance: 5, nextReceiveDays: 31 }), '会员券:B币券已领取 1 张 · 余额 5 · 下次可领 31 天后')
    assert.equal(renderVoucherLine({ action: 'already' }), '会员券:B币券已领取 0 张 · 今日已领过')
    assert.equal(renderVoucherLine({ action: 'skipped-none' }), '会员券:普通会员 · 跳过 B币券')
    assert.equal(renderVoucherLine({ action: 'unknown' }), '会员券:状态未知 · 跳过 B币券')
})

test('多账号标题写 N 个账号', () => {
    assert.ok(buildStartMessage({ date: '2026-10-11', account: '2 个账号' }).includes('B站任务 · 2 个账号 · 2026-10-11 · 开始运行'))
})
