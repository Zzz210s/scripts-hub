import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { ensureWindow, loadConfig, parseEnv, patchAccountName, patchTargetDuration } from '../src/config.js'
import { buildReport, maskSecret, truncateText, sendWecom } from '../src/notify.js'
import { isPaused, readState, recordRun, setPaused, writeState, appendHistory, readHistory } from '../src/state.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'weread-'))

test('parseEnv 支持注释、引号与空行', () => {
    assert.deepEqual(parseEnv('A=1\n# 注释\nB="x y"\n\nC=\'z\'\n'), { A: '1', B: 'x y', C: 'z' })
})

test('loadConfig 在缺少 .env 时给默认值', () => {
    const config = loadConfig(path.join(tmp(), 'missing.env'))
    assert.equal(config.requiredMinutes, 1800)
    assert.equal(config.minValidMinutes, 5)
    assert.equal(config.dailyCapMinutes, 120)
})

test('ensureWindow 在未配日期时按 30 天兜底并标记', () => {
    const config = ensureWindow(loadConfig(path.join(tmp(), 'missing.env')), '2026-10-01')
    assert.equal(config.challengeStart, '2026-10-01')
    assert.equal(config.challengeEndsOn, '2026-10-30')
    assert.equal(config.windowAssumed, true)
})

test('patchTargetDuration 只改 target_duration 且原子落盘', () => {
    const dir = tmp()
    const file = path.join(dir, 'config.yaml')
    fs.writeFileSync(file, 'reading:\n  target_duration: "60-72"\n  mode: "smart_random"\n', 'utf8')
    const range = patchTargetDuration(file, 66)
    assert.equal(range.low, 64)
    assert.equal(range.high, 70)
    assert.equal(range.changed, true)
    assert.match(fs.readFileSync(file, 'utf8'), /target_duration: "64-70"/)
    assert.ok(!fs.existsSync(`${file}.tmp`))
    // 目标与上次相同时不应报错,也不重写文件
    const again = patchTargetDuration(file, 66)
    assert.equal(again.changed, false)
})

test('maskSecret 隐藏 cookie 与 API Key', () => {
    const masked = maskSecret('wr_skey=abc123; wr_rt=web%40xyz; wrk-EXAMPLE123456')
    assert.ok(!masked.includes('abc123'))
    assert.ok(!masked.includes('xyz'))
    assert.ok(!masked.includes('EXAMPLE123456'))
})

test('truncateText 按字节截断', () => {
    assert.ok(Buffer.byteLength(truncateText('中'.repeat(1000), 100), 'utf8') <= 100)
})

test('buildReport 含今日/累计/剩余天数/可失败天数', () => {
    const text = buildReport({
        plan: { todayMinutes: 40, targetMinutes: 66, minutesSoFar: 300, remainingDays: 25, failableDays: 3, timeSlack: 9, daySlack: 3, validDaysSoFar: 5, validNeeded: 24, emergency: false },
        run: { ok: true, reportedSeconds: 2400, requests: 5, outcome: '成功' },
        config: { requiredMinutes: 1800, requiredValidDays: 29, windowAssumed: false },
        date: '2026-10-03',
        accountName: 'TestReader'
    })
    assert.match(text, /TestReader/)
    assert.match(text, /阅读:今日 40 分钟 · 目标 66 分钟 · 还差 26 分钟/)
    assert.match(text, /挑战:累计 5\.0 \/ 30\.0 小时 · 剩 25 天 · 有效 5\/29 · 还可漏 3 天/)
    assert.doesNotMatch(text, /本次:|上报 40 分钟|5 次请求/)
    assert.match(text, /福利:暂无可领/)
    assert.doesNotMatch(text, /[()]/)
})

test('sendWecom 在 dryRun 下不发请求,缺 webhook 时报错', async () => {
    let called = 0
    const dry = await sendWecom('hi', { dryRun: true, fetchImpl: async () => { called += 1 } })
    assert.equal(dry.ok, true)
    assert.equal(called, 0)
    const missing = await sendWecom('hi', { webhook: '' })
    assert.equal(missing.ok, false)
    assert.match(missing.error, /未配置/)
})

test('状态跨天自动重置,记录运行后按达标标记完成', () => {
    const dir = tmp()
    assert.equal(readState(dir).done, false)
    const state = recordRun(readState(dir), { minutes: 30, targetMinutes: 66, outcome: 'credited' })
    writeState(state, dir)
    assert.equal(readState(dir).todayMinutes, 30)
    assert.equal(readState(dir).done, false)
    const done = recordRun(readState(dir), { minutes: 70, targetMinutes: 66, outcome: 'credited' })
    assert.equal(done.done, true)
    // 换一天读:状态应重置
    const tomorrow = new Date(Date.now() + 86400000)
    assert.equal(readState(dir, tomorrow).todayMinutes, 0)
})

test('暂停开关与历史滚动', () => {
    const dir = tmp()
    assert.equal(isPaused(dir), false)
    setPaused(true, dir)
    assert.equal(isPaused(dir), true)
    setPaused(false, dir)
    assert.equal(isPaused(dir), false)
    for (let i = 0; i < 205; i += 1) appendHistory({ at: String(i) }, dir)
    assert.equal(readHistory(dir).length, 200)
})

test('patchAccountName 改写底座里的用户名,缺失时不动文件', () => {
    const dir = tmp()
    const file = path.join(dir, 'config.yaml')
    fs.writeFileSync(file, 'curl_config:\n  users:\n    - name: "default"\n      file_path: "secrets/read-request.curl"\n', 'utf8')
    const first = patchAccountName(file, 'TestReader')
    assert.equal(first.changed, true)
    assert.match(fs.readFileSync(file, 'utf8'), /- name: "TestReader"/)
    assert.equal(patchAccountName(file, 'TestReader').changed, false)
    const other = path.join(dir, 'other.yaml')
    fs.writeFileSync(other, 'no name here\n', 'utf8')
    assert.equal(patchAccountName(other, 'x').changed, false)
})

test('loadConfig 解析错峰同伴列表', () => {
    const dir = tmp()
    const env = path.join(dir, '.env')
    // 路径用 os.tmpdir() 拼:这个仓库要同时能在 Windows 与 Linux 上跑,不写死盘符
    const peerA = path.join(os.tmpdir(), 'weread-peer-a', 'run-state.js')
    const peerB = path.join(os.tmpdir(), 'weread-peer-b', 'run-state.js')
    fs.writeFileSync(env, [`BUSY_PEERS=${peerA}, ${peerB}`, 'ACCOUNT_NAME=测试名', ''].join('\n'), 'utf8')
    const config = loadConfig(env)
    assert.deepEqual(config.busyPeers, [peerA, peerB])
    assert.equal(config.accountName, '测试名')
})

test('日报福利行只报余额与体验卡,领取明细不再进消息', () => {
    const base = {
        plan: { todayMinutes: 40, targetMinutes: 66, minutesSoFar: 300, remainingDays: 25, failableDays: 3, timeSlack: 9, daySlack: 3, validDaysSoFar: 5, validNeeded: 24, emergency: false },
        run: { ok: true, reportedSeconds: 2400, requests: 5, outcome: '成功' },
        config: { requiredMinutes: 1800, requiredValidDays: 29, windowAssumed: false },
        date: '2026-10-03',
        accountName: 'TestReader'
    }
    const claimed = buildReport({ ...base, welfare: { claimed: true, coin: 3 } })
    assert.doesNotMatch(claimed, /阅读器书币/)
    assert.match(claimed, /福利:/)
    // 只有体验卡时福利行照旧报体验卡
    const withCard = buildReport({ ...base, welfare: { claimed: true, coin: 3 }, memberCard: { ok: true, freeCardDays: 3 } })
    assert.match(withCard, /福利:体验卡 3 天/)
    const unverified = buildReport({ ...base, welfare: { claimed: true, coin: 3, verified: false } })
    assert.match(unverified, /福利:领取未自证,建议核对/)
    const verifiedOk = buildReport({ ...base, welfare: { claimed: true, coin: 3, verified: true } })
    assert.doesNotMatch(verifiedOk, /未自证/)
    const failed = buildReport({ ...base, welfare: { claimed: false, ok: false, reason: 'claim-failed' } })
    assert.match(failed, /福利:阅读器书币领取失败,下次运行重试/)
})

test('日报福利行:档位总览与逐档领取明细不再进消息,失败与未自证仍报', () => {
    const base = {
        plan: { todayMinutes: 40, targetMinutes: 66, minutesSoFar: 300, remainingDays: 25, failableDays: 3, timeSlack: 9, daySlack: 3, validDaysSoFar: 5, validNeeded: 24, emergency: false },
        run: { ok: true, reportedSeconds: 2400, requests: 5, outcome: '成功' },
        config: { requiredMinutes: 1800, requiredValidDays: 29, windowAssumed: false },
        date: '2026-10-03',
        accountName: '测试账号'
    }
    const pick = { levelId: 1, levelDesc: '读 1 小时', choiceType: 2, awardNum: 2 }

    const claimed = buildReport({ ...base, weekly: { claimed: [pick] } })
    assert.doesNotMatch(claimed, /领取「/)
    assert.doesNotMatch(claimed, /本周/)
    assert.match(claimed, /福利:/)

    // 档位总览(周几档、已领、未达成)不再渲染
    const status = buildReport({ ...base, weeklyStatus: { tiers: { total: 8, claimed: 5, unreached: 3, claimable: 0 } } })
    assert.doesNotMatch(status, /本周 \d+ 档|已领 \d|未达成 \d|可领 \d/)

    const failed = buildReport({ ...base, weekly: { claimed: [], failed: [{ levelId: 3, levelDesc: '读 5 小时' }] } })
    assert.match(failed, /福利:档位领取失败,下次运行重试/)

    // 未自证与失败同时出现时两个信号都在(不能被 else if 吞掉)
    const both = buildReport({ ...base, weekly: { claimed: [{ ...pick, verified: false }], failed: [{ levelId: 3, levelDesc: '读 5 小时' }] } })
    assert.match(both, /领取未自证,建议核对/)
    assert.match(both, /档位领取失败,下次运行重试/)

    // 旧数据没有 verified 字段,不能凭空加提示
    const legacy = buildReport({ ...base, weekly: { claimed: [pick] } })
    assert.doesNotMatch(legacy, /未自证/)
})
