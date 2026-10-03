// 收口模块:两处福利共用一个入口,阅读时长福利的领取自证与失败隔离完全离线可测。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { collectRewards, logWeekly, weeklyForReport, weeklyLogLine, weeklyRecord } from '../src/rewards-run.js'

const CONFIG = { curlFile: 'secrets/read-request.curl' }
const CWD = '/tmp/weread-rewards'

function baseDeps(overrides = {}) {
    return {
        ensureAppToken: async () => ({ ok: true, vid: '1', accessToken: 'tok' }),
        claimWelfareOnce: async () => ({ ok: true, claimed: false, coin: 0, key: '', reason: 'no-coin' }),
        collectWeekly: async () => ({ ok: true, readingSeconds: 11161, readingDays: 3, claimable: 1, claimed: [], alreadyClaimed: [], failed: [] }),
        queryWeekly: async () => ({ ok: true, readingSeconds: 0, readingDays: 0, awards: [] }),
        // 挑战、余额与体验卡走网络,测试一律注入,避免真实请求
        collectChallenge: async () => ({ ok: true, list: [], reason: null }), readBalance: async () => ({ ok: true, balance: 0, giftBalance: 0, reason: null }),
        readMemberCard: async () => ({ ok: true, freeCardDays: 0, remainDays: 0, reason: null }),
        ...overrides
    }
}
const PICK = { levelId: 1, levelDesc: '读 1 小时', choiceType: 2, awardNum: 2 }

test('collectRewards 同时返回读者福利与阅读时长福利,并把注入的 fetchImpl 传给 weekly', async () => {
    const injectedReader = { ok: true, claimed: true, coin: 3, key: 'k', reason: 'claimable', verified: true }
    let seenCtx = null
    const deps = baseDeps({
        claimWelfareOnce: async () => injectedReader,
        collectWeekly: async ctx => {
            seenCtx = ctx
            return { ok: true, readingSeconds: 11161, readingDays: 3, claimable: 1, claimed: [PICK], alreadyClaimed: [], failed: [] }
        },
        fetchImpl: async () => ({ status: 200, text: async () => '{}' })
    })
    const { reader, weekly } = await collectRewards({ cwd: CWD, config: CONFIG, bot: {}, deps })

    assert.equal(reader, injectedReader)
    assert.equal(weekly.readingSeconds, 11161)
    assert.equal(typeof seenCtx.fetchImpl, 'function')   // 自证链路的 fetchImpl 不能是 undefined
    assert.equal(seenCtx.token.accessToken, 'tok')
})

test('collectRewards 领到后自证:状态仍为 2 才 verified=true', async () => {
    const need = status => baseDeps({
        collectWeekly: async () => ({ ok: true, readingSeconds: 100, readingDays: 2, claimable: 1, claimed: [PICK], alreadyClaimed: [], failed: [] }),
        queryWeekly: async () => ({ ok: true, awards: [{ levelId: 1, status }] })
    })

    const verified = await collectRewards({ cwd: CWD, config: CONFIG, bot: {}, deps: need(2) })
    assert.equal(verified.weekly.claimed[0].verified, true)

    const unverified = await collectRewards({ cwd: CWD, config: CONFIG, bot: {}, deps: need(1) })
    assert.equal(unverified.weekly.claimed[0].verified, false)
})

test('collectRewards 自证查询失败时保留原结果,不抛错也不误标 verified', async () => {
    const deps = baseDeps({
        collectWeekly: async () => ({ ok: true, readingSeconds: 100, readingDays: 2, claimable: 1, claimed: [PICK], alreadyClaimed: [], failed: [] }),
        queryWeekly: async () => { throw new Error('自证查询炸了') }
    })
    const { weekly } = await collectRewards({ cwd: CWD, config: CONFIG, bot: {}, deps })
    assert.equal(weekly.claimed.length, 1)
    assert.notEqual(weekly.claimed[0].verified, true)
})

test('collectRewards 阅读时长福利抛错不影响读者福利,反之亦然', async () => {
    const weeklyBoom = await collectRewards({
        cwd: CWD, config: CONFIG, bot: {},
        deps: baseDeps({ collectWeekly: async () => { throw new Error('weekly boom') } })
    })
    assert.equal(weeklyBoom.reader.ok, true)
    assert.equal(weeklyBoom.weekly.ok, false)
    assert.equal(weeklyBoom.weekly.reason, 'error')
    assert.match(weeklyBoom.weekly.error, /weekly boom/)

    const readerBoom = await collectRewards({
        cwd: CWD, config: CONFIG, bot: {},
        deps: baseDeps({ claimWelfareOnce: async () => { throw new Error('reader boom') } })
    })
    assert.equal(readerBoom.reader.ok, false)
    assert.equal(readerBoom.reader.reason, 'error')
    assert.equal(readerBoom.weekly.ok, true)
})

test('collectRewards 拿不到凭据时 weekly 记为 no-credentials,不进失败', async () => {
    const deps = baseDeps({ ensureAppToken: async () => ({ ok: false, error: '缺少 wr_rt' }) })
    const { weekly } = await collectRewards({ cwd: CWD, config: CONFIG, bot: {}, deps })
    assert.equal(weekly.ok, true)
    assert.equal(weekly.reason, 'no-credentials')
    assert.match(weekly.error, /wr_rt/)
    assert.deepEqual(weekly.claimed, [])
})

test('collectRewards:ensureAppToken 抛 ENOENT(缺 secrets 文件)按 no-credentials 归类', async () => {
    const deps = baseDeps({
        ensureAppToken: async () => { throw new Error("ENOENT: no such file or directory, open 'secrets/app-credentials.json'") }
    })
    const { weekly } = await collectRewards({ cwd: CWD, config: CONFIG, bot: {}, deps })
    assert.equal(weekly.ok, true)              // 不打扰:与「无可领」一样,不触发告警
    assert.equal(weekly.reason, 'no-credentials')
    assert.match(weekly.error, /ENOENT/)
    assert.deepEqual(weekly.claimed, [])
})

test('weeklyForReport:领到给 claimed,-2664 不算失败,真失败才给失败形状', () => {
    const allow = { dataDir: 'd', date: 'x', notifyOnce: () => true }
    assert.deepEqual(weeklyForReport({ claimed: [PICK] }), { claimed: [PICK] })
    // 只有 alreadyClaimed(-2664)时既不出「领取」也不出「失败」
    assert.equal(weeklyForReport({ claimed: [], alreadyClaimed: [PICK], failed: [] }), null)
    assert.deepEqual(weeklyForReport({ claimed: [], failed: [{ levelId: 3 }] }, allow), { claimed: [], failed: [{ levelId: 3 }] })
    assert.equal(weeklyForReport(null), null)
})

test('weeklyForReport:失败行受「每天一条」额度限制,同一天第二次为 null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-weekly-notify-'))
    const failed = { claimed: [], failed: [{ levelId: 3, levelDesc: '读 5 小时' }] }

    assert.deepEqual(weeklyForReport(failed, { dataDir: dir, date: '2026-10-03' }), failed)
    assert.equal(weeklyForReport(failed, { dataDir: dir, date: '2026-10-03' }), null)   // 同一天第二次被额度挡掉
    assert.deepEqual(weeklyForReport(failed, { dataDir: dir, date: '2026-10-04' }), failed)   // 换一天又有额度

    // 领到这一支不消耗额度,也不受额度影响
    assert.deepEqual(weeklyForReport({ claimed: [PICK] }, { dataDir: dir, date: '2026-10-03' }), { claimed: [PICK] })
})

test('weeklyRecord:固定字段形状,没结果时 null', () => {
    assert.equal(weeklyRecord(null), null)
    assert.deepEqual(weeklyRecord({ ok: true, readingSeconds: 9, readingDays: 1, claimable: 2, claimed: [PICK], alreadyClaimed: [PICK], failed: [] }), {
        ok: true,
        reason: null,
        readingSeconds: 9, readingDays: 1, tiers: { total: 0, claimed: 0, unreached: 0, claimable: 0 }, claimable: 2, claimed: [PICK], alreadyClaimed: [PICK], failed: []
    })
    assert.deepEqual(weeklyRecord({}), { ok: false, reason: null, readingSeconds: 0, readingDays: 0, tiers: { total: 0, claimed: 0, unreached: 0, claimable: 0 }, claimable: 0, claimed: [], alreadyClaimed: [], failed: [] })
    assert.deepEqual(weeklyRecord({ ok: false, reason: 'query-failed' }).reason, 'query-failed')
})

test('weeklyLogLine:拿不到凭据时打印脱敏且截断的原因', () => {
    const line = weeklyLogLine({
        ok: true, reason: 'no-credentials',
        error: `ENOENT: no such file, open 'secrets/app-credentials.json' accessToken=SUPER-SECRET refreshToken=ALSO-SECRET wr_skey=RAWCOOKIE; key=ABCDEF-123456`
    })
    assert.match(line, /reason=no-credentials/)
    assert.match(line, /error=ENOENT/)
    assert.ok(!line.includes('SUPER-SECRET'), '不能带出 accessToken')
    assert.ok(!line.includes('ALSO-SECRET'), '不能带出 refreshToken')
    assert.ok(!line.includes('RAWCOOKIE'), '不能带出 wr_skey')
    assert.ok(!line.includes('ABCDEF-123456'), '不能带出 key=')
    assert.doesNotMatch(line, /read=/)   // 不再退化成常规行、把 reason/error 丢掉
})

test('weeklyLogLine / logWeekly:一行可检索日志,写入异常被吞掉', () => {
    assert.match(weeklyLogLine(null), /skipped/)
    assert.match(weeklyLogLine({ ok: false, reason: 'query-failed' }), /reason=query-failed/)
    const line = weeklyLogLine({ ok: true, readingSeconds: 11161, readingDays: 3, claimable: 1, claimed: [{ ...PICK }], failed: [{ levelDesc: '读 5 小时', errcode: -1 }] })
    assert.match(line, /read=11161s days=3 claimable=1/)
    assert.match(line, /读 1 小时:coinx2/)
    assert.match(line, /读 5 小时:-1/)

    const written = []
    const result = logWeekly({ ok: true, readingSeconds: 1, readingDays: 1, claimable: 0 }, line2 => written.push(line2))
    assert.equal(written.length, 1)
    assert.equal(result.readingSeconds, 1)
    assert.doesNotThrow(() => logWeekly({}, () => { throw new Error('日志炸了') }))
})

test('weeklyForReport:一档领到一档失败时失败也进日报,且受额度限制', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-weekly-both-'))
    const failed = [{ levelId: 3, levelDesc: '读 5 小时' }]
    const both = { claimed: [PICK], failed }

    assert.deepEqual(weeklyForReport(both, { dataDir: dir, date: '2026-10-03' }), { claimed: [PICK], failed })
    // 同天第二次:失败被额度挡掉,但领到的那档照报
    assert.deepEqual(weeklyForReport(both, { dataDir: dir, date: '2026-10-03' }), { claimed: [PICK] })
    // 调用方漏传 dataDir 时不该抛错,失败退化成"每次都报"
    assert.deepEqual(weeklyForReport(both), { claimed: [PICK], failed })
})

test('collectRewards:App token 被判失效(401)时强制换一枚重试一次', async () => {
    const calls = []
    const collectWeekly = async ({ token }) => {
        calls.push(token.accessToken)
        return token.accessToken === 'fresh'
            ? { ok: true, readingSeconds: 60, readingDays: 1, claimable: 0, claimed: [], alreadyClaimed: [], failed: [] }
            : { ok: false, reason: 'query-failed', raw: { status: 401, text: '{"errcode":-2012,"errmsg":"登录超时"}' } }
    }
    const ensureAppToken = async ({ force }) => (force ? { ok: true, accessToken: 'fresh' } : { ok: true, accessToken: 'stale' })
    const { weekly } = await collectRewards({
        cwd: CWD, config: CONFIG, bot: {},
        deps: {
            collectWeekly, ensureAppToken, claimWelfareOnce: async () => null, welfareSafely: async () => null,
            collectChallenge: async () => ({ ok: true, list: [], reason: null }),
            readBalance: async () => ({ ok: true, balance: 0, giftBalance: 0, reason: null })
        }
    })
    assert.deepEqual(calls, ['stale', 'fresh'])
    assert.equal(weekly.ok, true)
})
