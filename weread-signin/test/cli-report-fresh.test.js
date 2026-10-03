// `report` 推送的数据来源:挑战/余额/体验卡实时优先,取数失败逐字段回落历史。
// 起因:2026-10-03 手动 report 出来的福利行少了「体验卡 N 天」—— 历史最后一条是当天早些时候写的,没有该字段。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { main } from '../src/cli.js'
import { pickReportSignals } from '../src/rewards-coins.js'

const PAID = {
    id: 'readchallenge4', isPaid: true, totalDays: 30, readSeconds: 14400, readDays: 3,
    targetDays: 29, targetSeconds: 108000, remainDays: 27, canMiss: 1
}
const STATS = { buckets: [{ day: '2026-10-03', seconds: 6600 }], todaySeconds: 6600 }
const NOW = new Date('2026-10-03T15:00:00')

/** 写一个临时 cwd:只有 data/history.json,历史里缺 memberCard。 */
function makeCwd(record) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-report-'))
    fs.mkdirSync(path.join(cwd, 'data'))
    fs.writeFileSync(path.join(cwd, 'data', 'history.json'), JSON.stringify([record]), 'utf8')
    return cwd
}

const HISTORY = {
    reportedSeconds: 3862,
    requests: 91,
    outcome: '成功',
    welfare: { claimed: false, coin: 0, reason: 'no-coin' },
    weekly: { ok: true, tiers: { total: 8, claimed: 5, unreached: 1, claimable: 2 }, claimed: [] },
    challenge: { ok: true, list: [PAID] },
    balance: { ok: true, balance: 22.6, giftBalance: 0, expiryBalance: 0 }
}

async function runReport(cwd, deps) {
    const lines = []
    const original = console.log
    console.log = (...args) => lines.push(args.join(' '))
    try {
        const code = await main(['node', 'cli.js', 'report', '--dry'], { cwd, now: NOW, ...deps })
        return { code, text: lines.join('\n') }
    } finally {
        console.log = original
    }
}

const baseDeps = (overrides = {}) => ({
    loadApiKey: () => 'test-key',
    readStats: async () => STATS,
    ensureAppToken: async () => ({ ok: true, vid: '1', accessToken: 'tok' }),
    collectChallenge: async () => ({ ok: true, list: [PAID] }),
    readBalance: async () => ({ ok: true, balance: 22.6, giftBalance: 0, expiryBalance: 0 }),
    readMemberCard: async () => ({ ok: true, freeCardDays: 4, remainDays: 4, isPaying: true }),
    ...overrides
})

test('pickReportSignals:实时成功优先,历史缺字段时也读实时', () => {
    const card = { ok: true, freeCardDays: 4 }
    const signals = pickReportSignals({ challenge: null, balance: null, memberCard: card }, { challenge: { ok: true } })
    assert.deepEqual(signals.memberCard, card)
    assert.deepEqual(signals.challenge, { ok: true })
    assert.equal(signals.balance, null)
})

test('pickReportSignals:实时失败或为空时回落历史;两边都失败保留实时', () => {
    const pastCard = { ok: true, freeCardDays: 7 }
    const signals = pickReportSignals(
        { challenge: { ok: false, reason: 'query-failed' }, balance: null, memberCard: null },
        { challenge: { ok: true, list: [PAID] }, balance: { ok: true, balance: 1 }, memberCard: pastCard }
    )
    assert.deepEqual(signals.challenge, { ok: true, list: [PAID] })
    assert.deepEqual(signals.balance, { ok: true, balance: 1 })
    assert.deepEqual(signals.memberCard, pastCard)
    const failed = { ok: false, reason: 'query-failed', freeCardDays: 0 }
    assert.deepEqual(pickReportSignals({ memberCard: failed }, { memberCard: { ok: false } }).memberCard, failed)
})

test('report:历史缺体验卡字段,实时可用时福利行带上体验卡', async () => {
    const cwd = makeCwd(HISTORY)
    const { code, text } = await runReport(cwd, baseDeps())
    assert.equal(code, 0)
    assert.match(text, /福利:书币余额 22\.60 · 即将过期 0\.00 · 体验卡 4 天/)
    const reportOnly = text.split('\n企业微信')[0]
    assert.doesNotMatch(reportOnly, /[()]/)
})

test('report:实时取数失败回落到历史,不崩且不发实时数据', async () => {
    const cwd = makeCwd(HISTORY)
    const { code, text } = await runReport(cwd, baseDeps({ ensureAppToken: async () => ({ ok: false, error: 'no-credentials' }) }))
    assert.equal(code, 0)
    assert.match(text, /福利:书币余额 22\.60 · 即将过期 0\.00/)
    assert.doesNotMatch(text, /体验卡/)
    assert.match(text, /挑战:付费 30 天/)
})

test('report:实时体验卡失败但历史有,就回落历史那张卡', async () => {
    const cwd = makeCwd({ ...HISTORY, memberCard: { ok: true, freeCardDays: 7, remainDays: 7 } })
    const { code, text } = await runReport(cwd, baseDeps({
        readMemberCard: async () => { throw new Error('card boom') }
    }))
    assert.equal(code, 0)
    assert.match(text, /体验卡 7 天/)
})

test('report:实时挑战接口抛错时整段报告仍成功', async () => {
    const cwd = makeCwd(HISTORY)
    const { code, text } = await runReport(cwd, baseDeps({
        collectChallenge: async () => { throw new Error('challenge boom') }
    }))
    assert.equal(code, 0)
    assert.match(text, /挑战:付费 30 天/)
    assert.match(text, /体验卡 4 天/)
})
