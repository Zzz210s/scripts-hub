// collectRewards 里挑战与余额的接线:共用一枚凭据、各自独立兜底、历史落盘形状。
import assert from 'node:assert/strict'
import test from 'node:test'

import { balanceRecord, challengeLogLine, challengeRecord, collectRewards, logChallenge, memberCardRecord } from '../src/rewards-run.js'
import { peekChallengeAndBalance } from '../src/rewards-coins.js'

const CONFIG = { curlFile: 'secrets/read-request.curl' }
const CWD = '/tmp/weread-rewards'

function baseDeps(overrides = {}) {
    return {
        ensureAppToken: async () => ({ ok: true, vid: '1', accessToken: 'tok' }),
        claimWelfareOnce: async () => ({ ok: true, claimed: false, coin: 0, key: '', reason: 'no-coin' }),
        collectWeekly: async () => ({ ok: true, readingSeconds: 11161, readingDays: 3, claimable: 1, claimed: [], alreadyClaimed: [], failed: [] }),
        queryWeekly: async () => ({ ok: true, readingSeconds: 0, readingDays: 0, awards: [] }),
        collectChallenge: async () => ({ ok: true, list: [], reason: null }),
        readBalance: async () => ({ ok: true, balance: 0, giftBalance: 0, reason: null }),
        readMemberCard: async () => ({ ok: true, freeCardDays: 0, remainDays: 0, reason: null }),
        ...overrides
    }
}

test('collectRewards:挑战、余额与体验卡用同一枚凭据返回', async () => {
    const seen = []
    const challenge = { ok: true, list: [{ id: 'readchallenge4', readDays: 2 }] }
    const balance = { ok: true, balance: 16.6, giftBalance: 16.6 }
    const memberCard = { ok: true, freeCardDays: 3, remainDays: 3 }
    const deps = baseDeps({
        collectChallenge: async ctx => { seen.push(ctx.token.accessToken); return challenge },
        readBalance: async ctx => { seen.push(ctx.token.accessToken); return balance },
        readMemberCard: async ctx => { seen.push(ctx.token.accessToken); return memberCard }
    })
    const out = await collectRewards({ cwd: CWD, config: CONFIG, bot: {}, deps })
    assert.deepEqual(out.challenge, challenge)
    assert.deepEqual(out.balance, balance)
    assert.deepEqual(out.memberCard, memberCard)
    assert.deepEqual(seen, ['tok', 'tok', 'tok'])
})

test('collectRewards:挑战接口抛错只标失败,不影响 weekly 与 reader', async () => {
    const reader = { ok: true, claimed: true, coin: 3, key: 'k', reason: 'claimable' }
    const deps = baseDeps({
        claimWelfareOnce: async () => reader,
        collectChallenge: async () => { throw new Error('challenge boom') },
        readBalance: async () => ({ ok: false, reason: 'query-failed', balance: 0, giftBalance: 0 })
    })
    const { reader: gotReader, weekly, challenge, balance } = await collectRewards({ cwd: CWD, config: CONFIG, bot: {}, deps })
    assert.equal(gotReader, reader)
    assert.equal(weekly.ok, true)
    assert.equal(challenge.ok, false)
    assert.deepEqual(challenge.list, [])
    assert.match(challenge.error, /challenge boom/)
    assert.equal(balance.ok, false)
})

test('collectRewards:App token 失效时挑战也强制换新重试一次', async () => {
    const calls = []
    const collectChallenge = async ({ token }) => {
        calls.push(token.accessToken)
        return token.accessToken === 'fresh'
            ? { ok: true, list: [], reason: null }
            : { ok: false, reason: 'query-failed', list: [], raw: { status: 401, text: '{"errcode":-2012,"errmsg":"登录超时"}' } }
    }
    const ensureAppToken = async ({ force }) => (force ? { ok: true, accessToken: 'fresh' } : { ok: true, accessToken: 'stale' })
    const { challenge } = await collectRewards({
        cwd: CWD, config: CONFIG, bot: {},
        deps: baseDeps({ ensureAppToken, collectChallenge })
    })
    assert.deepEqual(calls, ['stale', 'fresh'])
    assert.equal(challenge.ok, true)
})

test('challengeRecord / balanceRecord:固定字段形状,失败给空列表与 0', () => {
    assert.equal(challengeRecord(null), null)
    assert.deepEqual(challengeRecord({
        ok: true,
        list: [{ id: 'a', isPaid: true, totalDays: 30, readSeconds: 9360, readDays: 2, targetDays: 29, targetSeconds: 108000, remainDays: 28, canMiss: 1, rewardCoin: 30, extra: 'drop' }]
    }), {
        ok: true, reason: null,
        list: [{ id: 'a', isPaid: true, totalDays: 30, readSeconds: 9360, readDays: 2, targetDays: 29, targetSeconds: 108000, remainDays: 28, canMiss: 1, done: false, rewardCoin: 30, rewardCard: 0, extraRewardCoin: 0, extraRewardCard: 0 }]
    })
    assert.deepEqual(challengeRecord({ ok: false, reason: 'query-failed', list: [] }), { ok: false, reason: 'query-failed', list: [] })
    assert.equal(balanceRecord(null), null)
    assert.deepEqual(balanceRecord({ ok: true, balance: 16.6, giftBalance: 16.6, expiryBalance: 2.5 }), { ok: true, reason: null, balance: 16.6, giftBalance: 16.6, expiryBalance: 2.5 })
    assert.deepEqual(balanceRecord({ ok: false, reason: 'query-failed' }), { ok: false, reason: 'query-failed', balance: 0, giftBalance: 0, expiryBalance: 0 })
    assert.equal(memberCardRecord(null), null)
    assert.deepEqual(memberCardRecord({ ok: true, freeCardDays: 3, remainDays: 3, isPaying: true }), { ok: true, reason: null, freeCardDays: 3, remainDays: 3, isPaying: true })
    assert.deepEqual(memberCardRecord({ ok: false, reason: 'query-failed' }), { ok: false, reason: 'query-failed', freeCardDays: 0, remainDays: 0, isPaying: false })
})

test('challengeLogLine / logChallenge:一行可检索日志,失败与跳过都有形状', () => {
    const line = challengeLogLine(
        { ok: true, list: [{ isPaid: true, readDays: 2, targetDays: 29, remainDays: 28, canMiss: 1 }, { isPaid: false, readDays: 2, targetDays: 21, remainDays: 19, canMiss: 0 }] },
        { ok: true, balance: 16.6, giftBalance: 16.6 },
        { ok: true, freeCardDays: 3, remainDays: 3 }
    )
    assert.match(line, /\[CHALLENGE\] paid 2\/29d remain=28 miss=1 \| free 2\/21d remain=19 miss=0/)
    assert.match(line, /\[BALANCE\] balance=16\.6 gift=16\.6/)
    assert.match(line, /\[CARD\] freeCardDays=3 remainDays=3/)
    assert.match(challengeLogLine(null, null), /\[CHALLENGE\] skipped .*\[BALANCE\] skipped .*\[CARD\] skipped/)
    assert.match(challengeLogLine({ ok: false, reason: 'query-failed' }, { ok: false, reason: 'query-failed' }, { ok: false, reason: 'query-failed' }), /reason=query-failed.*reason=query-failed.*reason=query-failed/)

    const written = []
    logChallenge({ ok: true, list: [] }, { ok: true, balance: 0, giftBalance: 0 }, { ok: true, freeCardDays: 0, remainDays: 0 }, text => written.push(text))
    assert.equal(written.length, 1)
    assert.doesNotThrow(() => logChallenge(null, null, null, () => { throw new Error('日志炸了') }))
})

test('peekChallengeAndBalance:拿到凭据时返回挑战、余额与体验卡', async () => {
    const challenge = { ok: true, list: [{ id: 'readchallenge4', readDays: 2 }] }
    const balance = { ok: true, balance: 16.6, giftBalance: 16.6, expiryBalance: 0 }
    const memberCard = { ok: true, freeCardDays: 3, remainDays: 3 }
    const out = await peekChallengeAndBalance({
        cwd: CWD, config: CONFIG,
        deps: baseDeps({ collectChallenge: async () => challenge, readBalance: async () => balance, readMemberCard: async () => memberCard })
    })
    assert.equal(out.challenge, challenge)
    assert.equal(out.balance, balance)
    assert.equal(out.memberCard, memberCard)
})

test('peekChallengeAndBalance:缺凭据 / 抛错时返回 null,绝不抛错', async () => {
    const noCred = await peekChallengeAndBalance({ cwd: CWD, config: CONFIG, deps: baseDeps({ ensureAppToken: async () => ({ ok: false }) }) })
    assert.deepEqual(noCred, { challenge: null, balance: null, memberCard: null })

    const boom = await peekChallengeAndBalance({ cwd: CWD, config: CONFIG, deps: baseDeps({ ensureAppToken: async () => { throw new Error('ENOENT') } }) })
    assert.deepEqual(boom, { challenge: null, balance: null, memberCard: null })
})
