import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROGRAM, buildStartMessage, buildResultMessage, buildSkipMessage, buildActionMessage, renderDonateLine, renderVoucherLine, renderMangaLine, renderMangaBenefitLine, renderBigPointLine, renderExpLine } from '../src/messages.js'

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u
const EXP = { login: '已得 5', watch: '已得 5', share: '未完成', coins: '已得 50', total: 60 }

test('四条消息都不含圆括号与 emoji', () => {
    const messages = [
        buildStartMessage({ date: '2026-10-11' }),
        buildResultMessage({ date: '2026-10-11', exp: EXP, donate: { target: 5, stop: false, balance: 128 }, voucher: { action: 'received', count: 1, balance: 5, expireTime: 1794326400, nextReceiveDays: 16 }, manga: 'ok' }),
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
    const base = { date: '2026-10-11', exp: EXP, donate: { target: 5, stop: false, balance: 128 }, voucher: { action: 'received', count: 1 } }
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
})

// R5:报实际发生的投币数(余额差值),不是目标值
test('投币行报实际差值,不报目标', () => {
    assert.equal(
        renderDonateLine({ target: 5, stop: false, balance: 128, actual: 3, balanceAfter: 125 }),
        '投币:3 枚 · 投给关注的 UP · 余额 125.0'
    )
    assert.equal(
        renderDonateLine({ target: 5, stop: false, balance: 128, actual: 0, balanceAfter: 128 }),
        '投币:0 枚 · 未投出 · 余额 128.0'
    )
})

test('投币行取不到后值 -> 回落为明确标注的目标值', () => {
    assert.equal(
        renderDonateLine({ target: 5, stop: false, balance: 128, actual: null, balanceAfter: null }),
        '投币:目标 ≤5 枚 · 投给关注的 UP · 余额 128.0'
    )
})

// R6:大积分是上游已知问题,文案要诚实
test('大积分行指向已知问题,不写成我们坏了', () => {
    assert.equal(renderBigPointLine('failed'), '大积分:日常领取失败 · 上游 open #1195 · 不影响其它任务')
    assert.equal(renderBigPointLine(null), '')
})

test('会员券行带余额与有效期', () => {
    assert.equal(renderVoucherLine({ action: 'received', count: 1, balance: 5, expireTime: 1794326400, nextReceiveDays: 16 }), '会员券:B币券已领取 1 张 · 余额 5 · 有效至 2026-11-11 · 下次可领 16 天后')
    assert.equal(renderVoucherLine({ action: 'received', count: 1, balance: 5, nextReceiveDays: 31 }), '会员券:B币券已领取 1 张 · 余额 5 · 下次可领 31 天后')
    assert.equal(renderVoucherLine({ action: 'already' }), '会员券:B币券已领取 0 张 · 今日已领过')
    assert.equal(renderVoucherLine({ action: 'skipped-none' }), '会员券:普通会员 · 跳过 B币券')
    assert.equal(renderVoucherLine({ action: 'unknown' }), '会员券:状态未知 · 跳过 B币券')
})

test('漫画已签到不写成失败', () => {
    assert.equal(renderMangaLine({ sign: 'already', read: 'already' }), '漫画:今日已签到 · 阅读已完成')
    assert.equal(renderMangaLine({ sign: 'already', read: 'ok' }), '漫画:今日已签到 · 阅读成功')
    assert.equal(renderMangaLine({ sign: 'failed', read: 'unknown' }), '漫画:签到失败')
})

test('漫画行只说流程自己报的结果', () => {
    assert.equal(renderMangaLine({ sign: 'ok', read: 'ok' }), '漫画:签到成功 · 阅读成功')
    assert.equal(renderMangaLine({ sign: 'failed', read: 'ok' }), '漫画:签到失败 · 阅读成功')
    assert.equal(renderMangaLine({ sign: 'ok', read: 'failed' }), '漫画:签到成功 · 阅读失败')
    assert.equal(renderMangaLine({ sign: 'unknown', read: 'unknown' }), '漫画:签到结果未知')
    assert.equal(renderMangaLine({ skipped: true }), '')
})

test('漫画权益只在有真原因时单独报一行', () => {
    assert.equal(renderMangaBenefitLine(null), '')
    assert.equal(renderMangaBenefitLine({ status: 'ok', reason: null }), '')
    assert.equal(renderMangaBenefitLine({ status: 'failed', reason: null }), '')
    assert.equal(renderMangaBenefitLine({ status: 'failed', reason: '接口返回 500' }), '漫画权益:领取失败 · 接口返回 500')
})

test('每日任务行:真值与估算回落', () => {
    assert.equal(renderExpLine(EXP), '每日任务:登录 已得 5 · 观看 已得 5 · 分享 未完成 · 投币 已得 50 · 共 60 经验')
    assert.ok(renderExpLine({ ...EXP, estimated: true }).endsWith(' · 按计划口径估算'))
})

test('多账号标题写 N 个账号', () => {
    assert.ok(buildStartMessage({ date: '2026-10-11', account: '2 个账号' }).includes('B站任务 · 2 个账号 · 2026-10-11 · 开始运行'))
})

// 2026-10-11 实跑发现的两个诚实性缺口:余额没取到时渲染成 0.0;被上游跳过时仍说「漫画:已执行」
test('余额为 null 时不渲染余额,不冒充 0.0', () => {
    const line = renderDonateLine({ target: 5, actual: null, balance: null })
    assert.equal(line, '投币:目标 ≤5 枚 · 投给关注的 UP')
    assert.doesNotMatch(line, /余额/)
    assert.equal(renderDonateLine({ target: 5, actual: null, balance: '' }), '投币:目标 ≤5 枚 · 投给关注的 UP')
    // 空字符串不算数字,但 0 是真实余额,仍要显示
    assert.equal(renderDonateLine({ target: 5, actual: 0, balance: 0 }), '投币:0 枚 · 未投出 · 余额 0.0')
})

test('被上游整次跳过时不渲染漫画行', () => {
    assert.equal(renderMangaLine({ skipped: true }), '')
    const text = buildResultMessage({ date: '2026-10-12', exp: { login: '未完成', watch: '未完成', share: '未完成', coins: '未完成', total: 0 }, donate: { target: 5, actual: null, balance: null }, voucher: { action: 'unknown' }, manga: { skipped: true }, failures: [], ok: false })
    assert.doesNotMatch(text, /漫画/)
})
