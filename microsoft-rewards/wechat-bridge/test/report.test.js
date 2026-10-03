// 结果消息排版的测试(node --test 运行)。
//
//   cd E:\Microsoft-Rewards-Script-4.3.2
//   node --test wechat-bridge\test\report.test.js
//
// 排版约定见 automation-suite/docs/notification-convention.md。这里的断言锁住的是
// 用户 2026-10-03 提的那几个问题:标题行统一、汇总行一眼可扫、逐账号按今日得分降序、
// 低分原因跟在账号行后面、失败段能看出阶段、不再有重复的「今日累计」整行。
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSummary, failureStage, shortReason } from '../lib/report.js'

const DATE = new Date('2026-10-03T12:00:00')

const RUN = [
    '[2026/10/3 14:34:10] [MAIN] [INFO] MAIN [RUN-START] Starting Microsoft Rewards Script | v4.3.2 | Accounts: 2 | Clusters: 2',
    '[2026/10/3 14:35:00] [a1] [INFO] MAIN [ACCOUNT-START] Starting account: a1@x.com | geoLocale: auto',
    '[2026/10/3 14:35:00] [a2] [INFO] MAIN [ACCOUNT-START] Starting account: a2@x.com | geoLocale: auto',
    '[2026/10/3 15:00:00] [a1] [INFO] MAIN [ACCOUNT-END] Completed account: a1@x.com | pointsGained=67 | previousBalance=100 | currentBalance=167 | durationSeconds=600',
    '[2026/10/3 15:05:00] [a2] [INFO] MAIN [ACCOUNT-END] Completed account: a2@x.com | pointsGained=150 | previousBalance=200 | currentBalance=350 | durationSeconds=900',
    '[2026/10/3 15:06:00] [MAIN] [INFO] MAIN [RUN-END] Completed all accounts | accountsProcessed=2 | pointsGained=217 | previousBalance=300 | currentBalance=517 | runtimeMinutes=44.3'
]

test('成功运行的排版:标题 / 空行 / 汇总行 / 逐账号行降序', () => {
    const { text, marker } = buildSummary(RUN, { date: DATE, past: [] })
    const lines = text.split('\n')
    assert.equal(lines[0], '微软积分 · 2026-10-03 · 运行成功')
    assert.equal(lines[1], '')
    assert.equal(lines[2], '结果:2 个账号 · 本次 +217 分 · 耗时 44.3 分钟')
    assert.equal(lines[3], '账号 a2@x.com · 本次 +150 · 累计 350')
    assert.equal(lines[4], '账号 a1@x.com · 本次 +67 · 累计 167')
    assert.doesNotMatch(text, /[()]/)
    assert.doesNotMatch(text, /今日累计/)
    assert.deepEqual(marker, { day: '2026-10-03', status: 'ok', accounts: 2, gained: 217, dayGained: 217, runtimeMinutes: 44.3 })
})

test('当天跑过不止一次:汇总行带今日合计,逐账号行带今日得分', () => {
    const past = [
        { at: '2026-10-03T01:00:00.000Z', account: 'a1@x.com', gained: 45, before: 55, balance: 100, day: '2026-10-03' },
        { at: '2026-10-03T01:00:00.000Z', account: 'a2@x.com', gained: 30, before: 170, balance: 200, day: '2026-10-03' }
    ]
    const { text, marker } = buildSummary(RUN, { date: DATE, past })
    assert.match(text, /结果:2 个账号 · 本次 \+217 分 · 今日共 \+292 分 · 耗时 44\.3 分钟/)
    assert.match(text, /账号 a2@x\.com · 今日 \+180 · 本次 \+150 · 累计 350/)
    assert.match(text, /账号 a1@x\.com · 今日 \+112 · 本次 \+67 · 累计 167/)
    assert.equal(marker.dayGained, 292)
    // 逐账号行已经带今日得分,不再有单独的一整行「今日累计」
    assert.doesNotMatch(text, /^今日累计/m)
})

test('失败运行:失败段单列,并标出阶段;未完成的账号单独说', () => {
    const lines = [
        ...RUN.slice(0, 4),
        '[2026/10/3 15:00:30] [a2] [ERROR] MOBILE [FLOW] Mobile flow failed for a2@x.com: Navigation timeout',
        '[2026-10-03 15:06:00] === run finished with FAILURES, exit code 1 ==='
    ]
    const { text, marker } = buildSummary(lines, { date: DATE, past: [] })
    assert.equal(text.split('\n')[0], '微软积分 · 2026-10-03 · 运行有失败')
    assert.match(text, /失败:2 条/)
    assert.match(text, /  运行器结论 · === run finished with FAILURES, exit code 1 ===/)
    assert.match(text, /  主流程 · Mobile flow failed for a2@x\.com: Navigation timeout/)
    assert.match(text, /未完成:1 个账号 · a2@x\.com/)
    assert.equal(marker.status, 'failed')
})

test('没有任何账号记录的失败:只报原因与上次累计', () => {
    const { text, marker } = buildSummary(['[WATCHDOG] run killed after 150 minutes'], { date: DATE, past: [] })
    assert.equal(text.split('\n')[0], '微软积分 · 2026-10-03 · 运行有失败')
    assert.match(text, /原因:run killed after 150 minutes/)
    assert.equal(marker.accounts, 0)
    assert.equal(marker.gained, 0)
})

test('当天已经跑过 / 日志里没有结论时不推送', () => {
    assert.equal(buildSummary(['[2026-10-03 11:00:00] day 2026-10-03 already handled, attempts=1, skipped'], { date: DATE }).text, null)
    assert.equal(buildSummary(['[2026/10/3 14:00:00] [MAIN] [INFO] MAIN [ACCOUNT-START] Starting account: a1@x.com | geoLocale: auto'], { date: DATE }).text, null)
})

test('失败行能归到阶段,短原因去掉日志前缀', () => {
    assert.equal(failureStage('[2026/10/3 15:00:30] [a2] [ERROR] MOBILE [FLOW] Mobile flow failed for a2@x.com: timeout'), '主流程')
    assert.equal(failureStage('[2026/10/3 15:00:30] [a2] [ERROR] MAIN [ACCOUNT-ERROR] a2@x.com: boom'), '账号异常')
    assert.equal(shortReason('[2026/10/3 15:00:30] [a2] [ERROR] MAIN [ACCOUNT-ERROR] a2@x.com: boom'), 'a2@x.com: boom')
})
