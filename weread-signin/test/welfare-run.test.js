import assert from 'node:assert/strict'
import test from 'node:test'

import { claimWelfareOnce, logWelfare, welfareForReport, welfareLogLine, welfareRecord } from '../src/welfare-run.js'

test('welfareRecord:落盘字段固定,没结果时给 null', () => {
    assert.equal(welfareRecord(null), null)
    assert.equal(welfareRecord(undefined), null)

    // 领到时照实落盘
    assert.deepEqual(
        welfareRecord({ ok: true, claimed: true, coin: 3, key: 'k', reason: 'claimable', verified: true, verifyOk: true }),
        { coin: 3, key: 'k', claimed: true, reason: 'claimable', verified: true, verifyOk: true }
    )
    // 没领到(no-coin / claim-failed 之类)字段也齐全,不会缺 key 或多出 ok
    assert.deepEqual(
        welfareRecord({ ok: false, claimed: false, reason: 'claim-failed' }),
        { coin: 0, key: '', claimed: false, reason: 'claim-failed', verified: false, verifyOk: false }
    )
    assert.deepEqual(
        welfareRecord({ ok: true, claimed: false, coin: 0, key: '', reason: 'no-coin' }),
        { coin: 0, key: '', claimed: false, reason: 'no-coin', verified: false, verifyOk: false }
    )
})

test('welfareForReport:领取失败受每天一条额度,其余原样返回', () => {
    const failed = { ok: false, claimed: false, reason: 'claim-failed' }
    const allowed = welfareForReport(failed, { dataDir: 'd', date: '2026-10-03', notifyOnce: () => true })
    assert.equal(allowed, failed)

    const denied = welfareForReport(failed, { dataDir: 'd', date: '2026-10-03', notifyOnce: () => false })
    assert.equal(denied.ok, true)          // 额度用完:当作正常结果,日报不出那一行
    assert.equal(denied.reason, 'claim-failed')   // 其余字段保留
    assert.equal(denied.claimed, false)

    const claimed = { ok: true, claimed: true, coin: 3 }
    assert.equal(welfareForReport(claimed, { dataDir: 'd', date: 'x', notifyOnce: () => false }), claimed)

    const transient = { ok: false, reason: 'query-failed' }
    assert.equal(welfareForReport(transient, { dataDir: 'd', date: 'x', notifyOnce: () => false }), transient)

    assert.equal(welfareForReport(null, { dataDir: 'd', date: 'x' }), null)
})

test('claimWelfareOnce:拿不到凭据时如实报告原因,不因此触发告警', async () => {
    const ctx = { cwd: '/tmp/weread-signin', config: { curlFile: 'secrets/read-request.curl' }, bot: { bookId: 'book-1', chapterUid: 0 } }
    const skipped = await claimWelfareOnce({
        ...ctx,
        ensureToken: async () => ({ ok: false, error: '换取失败 HTTP 401:refreshToken 已过期' })
    })
    assert.equal(skipped.ok, true)              // 不打扰:与「无可领」一样不进告警
    assert.equal(skipped.claimed, false)
    assert.equal(skipped.coin, 0)
    assert.equal(skipped.reason, 'no-credentials')
    assert.match(skipped.error, /换取失败 HTTP 401/)

    let seenOptions = null
    let seenArgs = null
    const result = await claimWelfareOnce({
        ...ctx,
        ensureToken: async options => { seenOptions = options; return { ok: true, vid: 1, accessToken: 't' } },
        claim: async args => { seenArgs = args; return { ok: true, claimed: true, coin: 3, key: 'k', reason: 'claimable' } }
    })
    assert.match(seenOptions.curlFile, /read-request\.curl$/)
    assert.match(seenOptions.tokenFile, /secrets[\\/]app-token\.json$/)
    assert.match(seenOptions.credentialsFile, /secrets[\\/]app-credentials\.json$/)
    assert.equal(seenArgs.bookId, 'book-1')
    assert.equal(seenArgs.chapterUid, 0)
    assert.equal(result.claimed, true)
})

test('claimWelfareOnce:凭据或领取抛错都不冒泡,只返回错误结果', async () => {
    const ctx = { cwd: '/tmp/weread-signin', config: { curlFile: 'x' }, bot: {} }
    const tokenBoom = await claimWelfareOnce({ ...ctx, ensureToken: async () => { throw new Error('网络断了') } })
    assert.equal(tokenBoom.ok, false)
    assert.equal(tokenBoom.claimed, false)
    assert.equal(tokenBoom.reason, 'error')
    assert.match(tokenBoom.error, /网络断了/)

    const claimBoom = await claimWelfareOnce({
        ...ctx,
        ensureToken: async () => ({ ok: true, vid: 1, accessToken: 't' }),
        claim: async () => { throw new Error('领取炸了') }
    })
    assert.equal(claimBoom.ok, false)
    assert.equal(claimBoom.reason, 'error')
    assert.match(claimBoom.error, /领取炸了/)
})

test('welfareLogLine:带 [WELFARE] 前缀且含 reason 与 coin;凭据拿不到时说明跳过', () => {
    const skipped = welfareLogLine(null)
    assert.match(skipped, /\[WELFARE\]/)
    assert.match(skipped, /reason=no-credentials/)   // 跳过原因
    assert.match(skipped, /coin=0/)

    const noCoin = welfareLogLine({ ok: true, claimed: false, coin: 0, reason: 'no-coin' })
    assert.match(noCoin, /reason=no-coin/)
    assert.match(noCoin, /coin=0/)
    assert.match(noCoin, /claimed=false/)
    assert.match(noCoin, /verified=false/)

    const claimed = welfareLogLine({ ok: true, claimed: true, coin: 5, key: 'SECRET-KEY', reason: 'claimable', verified: true })
    assert.match(claimed, /reason=claimable/)
    assert.match(claimed, /coin=5/)
    assert.match(claimed, /claimed=true/)
    assert.match(claimed, /verified=true/)
    assert.ok(!claimed.includes('SECRET-KEY'), '日志不能带出服务端 key')
})

test('welfareLogLine:凭据换取失败时带上脱敏且截断的原因', () => {
    const line = welfareLogLine({
        ok: true, claimed: false, coin: 0, reason: 'no-credentials',
        error: `换取失败 HTTP 401:{"accessToken":"SUPER-SECRET","refreshToken":"ALSO-SECRET","errmsg":"${'很长'.repeat(80)}"}`
    })
    assert.match(line, /reason=no-credentials/)
    assert.match(line, /error=换取失败 HTTP 401/)
    assert.ok(!line.includes('SUPER-SECRET'), '不能带出 accessToken')
    assert.ok(!line.includes('ALSO-SECRET'), '不能带出 refreshToken')
    const preview = line.slice(line.indexOf('error=') + 'error='.length)
    assert.ok(preview.length <= 80, `error 预览应截断到 80 字符,实际 ${preview.length}`)
})

test('logWelfare:写一行且原样返回结果;写入端抛错也不冒泡', () => {
    const welfare = { ok: true, claimed: false, coin: 0, reason: 'no-coin' }
    const lines = []
    assert.equal(logWelfare(welfare, line => lines.push(line)), welfare)
    assert.equal(lines.length, 1)
    assert.match(lines[0], /\[WELFARE\]/)
    assert.match(lines[0], /reason=no-coin/)

    // 日志只是旁路:写入端炸了也不能影响本次运行
    assert.doesNotThrow(() => logWelfare(welfare, () => { throw new Error('stdout 关了') }))
})

test('App token 失效(401 -2012)时强制换一枚再试一次', async () => {
    const calls = []
    const expired = { ok: false, claimed: false, reason: 'query-failed', queryRaw: { ok: false, status: 401, text: '{"errcode":-2012,"errmsg":"登录超时"}' } }
    const okResult = { ok: true, claimed: false, coin: 0, key: '', reason: 'no-coin' }
    const claim = async ({ token }) => { calls.push(token.accessToken); return token.accessToken === 'fresh' ? okResult : expired }
    const ensureToken = async args => { calls.push(args.force ? 'force' : 'cached'); return args.force ? { ok: true, accessToken: 'fresh' } : { ok: true, accessToken: 'stale' } }

    const result = await claimWelfareOnce({ cwd: '.', config: { curlFile: 'secrets/read-request.curl' }, bot: { bookId: 'b', chapterUid: 0 }, claim, ensureToken })
    assert.equal(result, okResult)
    assert.deepEqual(calls, ['cached', 'stale', 'force', 'fresh'])
})

test('App token 失效但换不到新 token 时如实返回第一次的结果', async () => {
    const expired = { ok: false, claimed: false, reason: 'query-failed', queryRaw: { ok: false, status: 401, text: '登录超时' } }
    const claim = async () => expired
    const ensureToken = async args => (args.force ? { ok: false, error: '换不到' } : { ok: true, accessToken: 'stale' })
    const result = await claimWelfareOnce({ cwd: '.', config: { curlFile: 'x' }, bot: {}, claim, ensureToken })
    assert.equal(result, expired)
})

test('不是 token 失效的失败不触发重试', async () => {
    let calls = 0
    const failed = { ok: false, claimed: false, reason: 'query-failed', queryRaw: { ok: false, status: 500, text: 'oops' } }
    const claim = async () => { calls += 1; return failed }
    const ensureToken = async () => ({ ok: true, accessToken: 't' })
    const result = await claimWelfareOnce({ cwd: '.', config: { curlFile: 'x' }, bot: {}, claim, ensureToken })
    assert.equal(result, failed)
    assert.equal(calls, 1)
})
