// 会话循环:一次运行内按官方口径补读,直到达标 / 用完会话配额 / 底座失败 / 统计读不到。
// 完全离线:统计、底座、凭据、福利全部注入。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { runOnce } from '../src/run.js'

const NOW = new Date('2026-01-10T12:00:00')
const CREDENTIAL = { ok: true, renewed: false, changed: [], check: { name: '测试号' } }
const BOT_OK = { ok: true, killed: false, exitCode: 0, seconds: 60, stderr: '', stdout: '实际阅读: 5分0秒\n成功请求: 1次\n失败请求: 0次\n' }

function fixture(extraEnv = {}) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-loop-'))
    fs.mkdirSync(path.join(cwd, 'data'), { recursive: true })
    fs.writeFileSync(path.join(cwd, 'config.yaml'), 'accounts:\n  - name: "旧名"\ntarget_duration: "1-2"\n', 'utf8')
    const env = {
        QUIET_START: '00:00',
        QUIET_END: '00:00',
        SHUTDOWN_TIME: '23:59',
        SHUTDOWN_GUARD_MINUTES: 1,
        CHALLENGE_START: '2026-01-01',
        CHALLENGE_ENDS_ON: '2026-01-30',
        // 把总量调小,让"达标"在测试里可控:目标 ≈ (600-10)/21 + 6 ≈ 35 分钟
        REQUIRED_MINUTES: '600',
        DAILY_CAP_MINUTES: '120',
        MIN_VALID_MINUTES: '5',
        MAX_SESSIONS_PER_RUN: '3',
        ...extraEnv
    }
    fs.writeFileSync(path.join(cwd, '.env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'), 'utf8')
    return cwd
}

const stats = (todaySeconds) => ({
    ok: true,
    stats: { totalSeconds: todaySeconds, readDays: 1, dayAverageSeconds: todaySeconds, compare: null, buckets: [{ day: '2026-01-10', seconds: todaySeconds }], todaySeconds }
})

/**
 * 造一次运行:每次读统计按 afterList 依次给值(开始前那次给 beforeSeconds)。
 * runBot 的次数与每次写回的目标都记下来,便于断言"每个会话前都重算目标"。
 */
async function runLoop({ beforeSeconds = 600, afterList = [], botList = [], failStatsFrom, env = {} } = {}) {
    const cwd = fixture(env)
    const botCalls = []
    const targets = []
    let statsCalls = 0
    const result = await runOnce({
        cwd,
        now: NOW,
        deps: {
            ensureCredential: async () => CREDENTIAL,
            runBot: async () => {
                const bot = botList[botCalls.length] ?? BOT_OK
                botCalls.push(bot)
                targets.push(fs.readFileSync(path.join(cwd, 'config.yaml'), 'utf8').match(/target_duration: "(.*)"/)?.[1])
                return bot
            },
            readStatsWithRetry: async () => {
                const index = statsCalls++
                if (index === 0) return stats(beforeSeconds)
                if (failStatsFrom !== undefined && index >= failStatsFrom) return { ok: false, error: 'HTTP 503' }
                return stats(afterList[index - 1] ?? beforeSeconds)
            },
            collectRewards: async () => ({ reader: null, weekly: null, challenge: null, balance: null, memberCard: null })
        }
    })
    return { cwd, result, botCalls, targets }
}

test('官方口径达标:只跑一个会话就停', async () => {
    const { result, botCalls } = await runLoop({ beforeSeconds: 600, afterList: [4000] })
    assert.equal(botCalls.length, 1)
    assert.equal(result.sessions, 1)
    assert.equal(result.stopReason, 'done')
    assert.equal(result.afterMinutes, 67)
})

test('不达标就再来一个会话,并且每个会话前都按最新进度重算目标', async () => {
    const { result, botCalls, targets } = await runLoop({ beforeSeconds: 600, afterList: [900, 4000] })
    assert.equal(botCalls.length, 2)
    assert.equal(result.sessions, 2)
    assert.equal(result.stopReason, 'done')
    assert.equal(result.afterMinutes, 67)
    assert.equal(targets.length, 2)
    assert.notEqual(targets[0], undefined)
    assert.notEqual(targets[1], undefined)
})

test('一直不达标:跑到会话配额上限就停,不会无限刷', async () => {
    const { result, botCalls } = await runLoop({ beforeSeconds: 600, afterList: [610, 620, 630, 640] })
    assert.equal(botCalls.length, 3)
    assert.equal(result.sessions, 3)
    assert.equal(result.stopReason, 'sessions-exhausted')
})

test('底座自己失败:不刷下一个会话,如实收尾', async () => {
    const bad = { ok: false, killed: false, exitCode: 1, seconds: 0, stderr: 'boom', stdout: '' }
    const { result, botCalls } = await runLoop({ beforeSeconds: 600, afterList: [900, 900, 900], botList: [bad, BOT_OK, BOT_OK] })
    assert.equal(botCalls.length, 1)
    assert.equal(result.stopReason, 'bot-failed')
    assert.match(result.run.outcome, /失败/)
})

test('查不到官方统计:连失败两次就停,并给出告警文案', async () => {
    const { result, botCalls } = await runLoop({ beforeSeconds: 600, afterList: [900], failStatsFrom: 1 })
    assert.equal(botCalls.length, 2)
    assert.equal(result.stopReason, 'stats-unavailable')
    assert.match(result.run.note, /读回失败/)
})

test('会话数配额可以由环境变量下调(MAX_SESSIONS_PER_RUN=2)', async () => {
    const { result, botCalls } = await runLoop({ beforeSeconds: 600, afterList: [610, 620, 630], env: { MAX_SESSIONS_PER_RUN: '2' } })
    assert.equal(botCalls.length, 2)
    assert.equal(result.sessions, 2)
})

test('attempts 按会话累加,不因循环重复计数', async () => {
    const { cwd, result } = await runLoop({ beforeSeconds: 600, afterList: [900, 950, 4000] })
    const state = JSON.parse(fs.readFileSync(path.join(cwd, 'data', 'state.json'), 'utf8'))
    assert.equal(state.attempts, result.sessions)
    assert.equal(state.done, true)
    assert.equal(state.todayMinutes, 67)
})
