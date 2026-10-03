import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildSkipMessage, buildStartMessage, shouldNotifyOnce } from '../src/notify-policy.js'

const plan = { todayMinutes: 20, targetMinutes: 66, minutesSoFar: 300, remainingDays: 29, failableDays: 1, sections: [{ minutes: 30 }, { minutes: 16 }] }
const config = { quietStart: '20:00', quietEnd: '23:00', shutdownTime: '02:00', shutdownGuardMinutes: 30, requiredMinutes: 1800, requiredValidDays: 29 }

test('跳过文案回答"为什么跳过/会自动重试吗/我需要做什么",且不带圆括号', () => {
    const peer = buildSkipMessage({ reason: 'peer-running', detail: 'Microsoft-Rewards-Script-4.3.2 正在运行 · 已 41 分钟', plan, config, date: '2026-10-02', accountName: 'TestReader' })
    assert.match(peer, /微信读书签到 · TestReader · 2026-10-02 · 正常跳过/)
    assert.match(peer, /原因:Microsoft-Rewards-Script-4.3.2 正在运行/)
    assert.match(peer, /后续:约 1 小时后或下次登录触发时自动重试/)
    assert.match(peer, /你需要做什么:不需要/)
    assert.match(peer, /今日已读 20 \/ 66 分钟 · 官方口径 · 含你自己的阅读/)
    assert.doesNotMatch(peer, /[()]/)

    const cred = buildSkipMessage({ reason: 'credential-invalid', detail: 'HTTP 401', plan, config, date: '2026-10-02' })
    assert.match(cred, /· 需要你处理/)
    assert.match(cred, /请你:重新抓一次 read 请求的 cURL,覆盖 secrets\/read-request\.curl/)
    assert.match(cred, /原因:登录凭据失效,自动续期也没成功 · HTTP 401/)
    assert.match(cred, /不处理的后果:/)
    assert.doesNotMatch(cred, /正常跳过/)
    assert.doesNotMatch(cred, /[()]/)

    // 读不到官方统计现在也是需要人工处理:cookie 或接口有问题时不处理就一直不跑
    const stats = buildSkipMessage({ reason: 'stats-unavailable', detail: '统计接口 HTTP 500', plan, config, date: '2026-10-02' })
    assert.match(stats, /· 需要你处理/)
    assert.match(stats, /请你:/)
    assert.match(stats, /原因:读不到官方阅读统计 · 统计接口 HTTP 500/)
    assert.match(stats, /不处理的后果:/)
    assert.doesNotMatch(stats, /正常跳过|你需要做什么:不需要/)
    assert.doesNotMatch(stats, /[()]/)

    const done = buildSkipMessage({ reason: 'done', plan, config, date: '2026-10-02' })
    assert.match(done, /今天已经达标 · 官方统计 20 分钟 · 目标 66 分钟/)
    assert.match(done, /你需要做什么:不需要/)
    assert.doesNotMatch(done, /[()]/)

    const mem = buildSkipMessage({ reason: 'low-memory', plan: null, config, date: '2026-10-02' })
    assert.match(mem, /原因:可用内存不足 · 未知/)
    assert.doesNotMatch(mem, /[()]/)
})

test('开始提示只有一句话,不再带目标、分段、挑战与福利', () => {
    const challenge = { ok: true, list: [{ isPaid: true, totalDays: 30, readSeconds: 9720, readDays: 2, targetDays: 29, targetSeconds: 108000, remainDays: 28, canMiss: 1 }] }
    const text = buildStartMessage({
        plan: { todayMinutes: 135, targetMinutes: 5, minutesSoFar: 300, remainingDays: 29, failableDays: 1, sections: [{ minutes: 3 }, { minutes: 2 }] },
        config,
        date: '2026-10-02',
        accountName: 'TestReader',
        challenge,
        balance: { ok: true, balance: 16.6, expiryBalance: 0 },
        memberCard: { ok: true, freeCardDays: 3 }
    })
    assert.equal(text, '微信读书签到 · TestReader · 2026-10-02 · 开始自动阅读')
    assert.doesNotMatch(text, /挑战:|福利:|今天:|计划:|窗口:|后续:/)
    assert.doesNotMatch(text, /[()]/)
})

test('跳过提醒同一天同一种原因只发一次,需人工处理的不限', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-notify-'))
    assert.equal(shouldNotifyOnce(dir, 'peer-running', '2026-10-02'), true)
    assert.equal(shouldNotifyOnce(dir, 'peer-running', '2026-10-02'), false)
    assert.equal(shouldNotifyOnce(dir, 'peer-running', '2026-10-03'), true)   // 换一天可以再发
    assert.equal(shouldNotifyOnce(dir, 'done', '2026-10-02'), true)
    assert.equal(shouldNotifyOnce(dir, 'credential-invalid', '2026-10-02'), true)
    assert.equal(shouldNotifyOnce(dir, 'credential-invalid', '2026-10-02'), true)  // 每次都提醒
    assert.equal(shouldNotifyOnce(dir, 'stats-unavailable', '2026-10-02'), true)
    assert.equal(shouldNotifyOnce(dir, 'stats-unavailable', '2026-10-02'), true)  // 每次都提醒
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'notify-state.json'), 'utf8'))
    assert.equal(state['peer-running'], '2026-10-03')
})
