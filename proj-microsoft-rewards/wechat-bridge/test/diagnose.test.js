import assert from 'node:assert/strict'
import test from 'node:test'

import { explainLowScore, LOW_SCORE_THRESHOLD } from '../lib/diagnose.js'
import { buildSummary } from '../notify-run.js'

// 下面这些行是从 2026-09-27 的真实日志里抄下来的形状(只改了邮箱与数字)
const LOW_ACCOUNT = [
    '[2026/9/27 10:46:39] [sample] [INFO] MAIN [POINTS] Earnable today | Mobile: 0 | Browser: 0 | App: 5 | sample@gmail.com | locale: en-US',
    '[2026/9/27 10:49:24] [sample] [INFO] MAIN [SEARCH-MANAGER] Mobile: skip (complete, 0/0) | Desktop: skip (complete, 50/50)',
    '[2026/9/27 10:49:32] [sample] [INFO] MAIN [ACCOUNT-END] Completed account: sample@gmail.com | pointsGained=15 | previousBalance=1730 | currentBalance=1745 | durationSeconds=209.1',
    '[2026/9/27 11:13:18] [MAIN] [INFO] MAIN [RUN-END] Completed all accounts | accountsProcessed=5 | pointsGained=665 | previousBalance=17413 | currentBalance=18078 | runtimeMinutes=47.5'
]

const HEALTHY_ACCOUNT = [
    '[2026/9/27 10:53:28] [sample] [INFO] MAIN [POINTS] Earnable today | Mobile: 0 | Browser: 2 | App: 35 | sample@outlook.com | locale: en-CN',
    '[2026/9/27 11:12:00] [sample] [INFO] MAIN [SEARCH-MANAGER] Mobile: skip (complete, 0/0) | Desktop: run (48/50, missing 2)',
    '[2026/9/27 11:13:18] [sample] [INFO] MAIN [ACCOUNT-END] Completed account: sample@outlook.com | pointsGained=250 | previousBalance=1478 | currentBalance=1728 | durationSeconds=1189.8',
    '[2026/9/27 11:13:18] [MAIN] [INFO] MAIN [RUN-END] Completed all accounts | accountsProcessed=5 | pointsGained=665 | previousBalance=17413 | currentBalance=18078 | runtimeMinutes=47.5'
]

test('低分账号能读出原因:桌面搜索无可赚分 + App 仅剩少量,且同义表述合并成一句', () => {
    const reason = explainLowScore('sample@gmail.com', LOW_ACCOUNT)
    assert.match(reason, /桌面搜索运行前已领完/)
    assert.match(reason, /已完成跳过/)
    assert.match(reason, /App 侧可赚积分仅剩 5 分/)
    // 同义不重复:不能同时出现"已领完"和"已完成跳过"两个独立分句
    assert.equal(reason.split(' · ').filter(part => /已完成跳过/.test(part)).length, 1)
    assert.doesNotMatch(reason, /[()]/)
})

test('正常账号不产生原因', () => {
    assert.equal(explainLowScore('sample@outlook.com', HEALTHY_ACCOUNT), null)
})

test('阈值是 50 分(正常日单账号 195-250,低于此值才归因)', () => {
    assert.equal(LOW_SCORE_THRESHOLD, 50)
})

test('推送里低分原因缩进跟在对应账号行后面', () => {
    const { text } = buildSummary([...LOW_ACCOUNT, ...HEALTHY_ACCOUNT], { past: [] })
    const lines = text.split('\n')
    const reason = lines.findIndex(line => line.startsWith('  原因:'))
    assert.ok(reason > 0, '应有缩进的原因行')
    assert.match(lines[reason - 1], /^账号 sample@gmail\.com · /)
    assert.match(lines[reason], /桌面搜索运行前已领完/)
    // 原因不再堆成末尾一大段
    assert.ok(!lines.slice(0, reason).some(line => /低分原因/.test(line)))
})

test('全员正常时推送里没有原因行', () => {
    const { text } = buildSummary(HEALTHY_ACCOUNT, { past: [] })
    assert.ok(!/原因:/.test(text))
})
