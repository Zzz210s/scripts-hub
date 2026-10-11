// 自证的接线与证据:collectRewards 把重试/反证接到一起(R1/R2),结果进历史与日志(R4),
// 日报只在真正无法证明时才提示(R5)。全离线:query / reclaim / sleep 注入。
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { renderWelfareLine } from '../src/report.js'
import { collectRewards, weeklyLogLine, weeklyRecord } from '../src/rewards-run.js'

const CONFIG = { curlFile: 'secrets/read-request.curl' }
const CWD = path.join(os.tmpdir(), 'weread-rewards')
const PICK = { levelId: 13, levelDesc: '读 7 天', choiceType: 1, awardNum: 2 }
const claimedOnce = () => ({ ok: true, readingSeconds: 26392, readingDays: 7, claimable: 1, claimed: [PICK], alreadyClaimed: [], failed: [] })

function baseDeps(overrides = {}) {
    return {
        ensureAppToken: async () => ({ ok: true, vid: '1', accessToken: 'tok' }),
        claimWelfareOnce: async () => ({ ok: true, claimed: false, coin: 0, key: '', reason: 'no-coin' }),
        collectWeekly: claimedOnce,
        queryWeekly: async () => ({ ok: true, awards: [] }),
        // 自证链路的默认桩:不真等 6-10 秒,也不让重领反证走到真网络
        claimWeekly: async () => ({ ok: false, status: 499, errcode: -1, alreadyClaimed: false }),
        sleep: async () => {}, verifyDelayMs: 0,
        collectChallenge: async () => ({ ok: true, list: [], reason: null }),
        readBalance: async () => ({ ok: true, balance: 0, giftBalance: 0, reason: null }),
        readMemberCard: async () => ({ ok: true, freeCardDays: 0, remainDays: 0, reason: null }),
        ...overrides
    }
}

test('collectRewards 领到后复查到 status=2:verified=true / via=status', async () => {
    const deps = baseDeps({ queryWeekly: async () => ({ ok: true, awards: [{ levelId: 13, status: 2 }] }) })
    const { weekly } = await collectRewards({ cwd: CWD, config: CONFIG, bot: {}, deps })
    assert.equal(weekly.claimed[0].verified, true)
    assert.equal(weekly.claimed[0].via, 'status')
})

test('collectRewards 复查三次都没证明、反证得 -2664:verified=true / via=already', async () => {
    const slept = []
    const reclaims = []
    const deps = baseDeps({
        queryWeekly: async () => ({ ok: true, awards: [{ levelId: 13, status: 1 }] }),
        sleep: async ms => slept.push(ms),
        claimWeekly: async (_ctx, claim) => {
            reclaims.push(claim.levelId)
            return { ok: false, status: 499, errcode: -2664, alreadyClaimed: true }
        }
    })
    const { weekly } = await collectRewards({ cwd: CWD, config: CONFIG, bot: {}, deps })

    assert.deepEqual(slept, [0, 0], '两次复查之间各等一次(间隔注入)')
    assert.deepEqual(reclaims, [13], '反证只对刚领取的档位发一次')
    assert.equal(weekly.claimed[0].verified, true)
    assert.equal(weekly.claimed[0].via, 'already')
})

test('collectRewards 复查与反证都失败:未自证但不抛穿,运行结果照旧', async () => {
    const deps = baseDeps({
        queryWeekly: async () => ({ ok: false, reason: 'query-failed' }),
        claimWeekly: async () => { throw new Error('反证也炸了') }
    })
    const { weekly } = await collectRewards({ cwd: CWD, config: CONFIG, bot: {}, deps })
    assert.equal(weekly.claimed.length, 1)
    assert.equal(weekly.claimed[0].verified, false)
    assert.equal(weekly.claimed[0].via, null)
    assert.equal(weekly.readingSeconds, 26392)
})

test('R4 weeklyRecord 保留 verified/via/unverified,JSON 往返后仍在(事后可排查)', async () => {
    const deps = baseDeps({ queryWeekly: async () => ({ ok: true, awards: [{ levelId: 13, status: 2 }] }) })
    const { weekly } = await collectRewards({ cwd: CWD, config: CONFIG, bot: {}, deps })
    const record = weeklyRecord(weekly)
    assert.equal(record.claimed[0].verified, true)
    assert.equal(record.claimed[0].via, 'status')
    assert.deepEqual(record.unverified, [])

    const roundTrip = JSON.parse(JSON.stringify(record))
    assert.equal(roundTrip.claimed[0].verified, true)
    assert.equal(roundTrip.claimed[0].via, 'status')
    assert.deepEqual(weeklyRecord({ claimed: [{ ...PICK, verified: false, via: null }] }).unverified, [13])
})

test('R4 [WEEKLY] 日志带自证结果与证明方式,且不含任何凭据', () => {
    const line = weeklyLogLine({ ...claimedOnce(), claimed: [{ ...PICK, verified: true, via: 'already' }] })
    assert.match(line, /claimed=\[读 7 天:cardx2:verified\]/)
    assert.match(line, /unverified=\[\]/)
    assert.match(line, /via=\[读 7 天:already\]/)

    const bad = weeklyLogLine({ ...claimedOnce(), claimed: [{ ...PICK, verified: false, via: null }] })
    assert.match(bad, /unverified=\[读 7 天\]/)

    const secret = weeklyLogLine({
        ok: true, reason: 'no-credentials',
        error: 'accessToken=SUPER-SECRET refreshToken=ALSO-SECRET wr_skey=RAWCOOKIE key=ABCDEF-123456'
    })
    for (const leaked of ['SUPER-SECRET', 'ALSO-SECRET', 'RAWCOOKIE', 'ABCDEF-123456']) {
        assert.ok(!secret.includes(leaked), `不能带出 ${leaked}`)
    }
})

test('R5 日报只在真正无法证明时才提示,文案不变且无圆括号', () => {
    const base = { balance: { ok: true, balance: 9.61, expiryBalance: 0 }, memberCard: { ok: true, freeCardDays: 2 } }
    const ok = renderWelfareLine({ ...base, weekly: { claimed: [{ ...PICK, verified: true, via: 'status' }] } })
    assert.equal(ok, '福利:书币余额 9.61 · 即将过期 0.00 · 体验卡 2 天')

    const bad = renderWelfareLine({ ...base, weekly: { claimed: [{ ...PICK, verified: false, via: null }] } })
    assert.match(bad, /领取未自证,建议核对$/)
    assert.ok(!bad.includes('(') && !bad.includes('（') && !bad.includes('）'), '文案不加圆括号')

    // verified === undefined 是旧数据,不臆断也不提示
    const legacy = renderWelfareLine({ ...base, weekly: { claimed: [{ ...PICK }] } })
    assert.ok(!legacy.includes('领取未自证'))
})
