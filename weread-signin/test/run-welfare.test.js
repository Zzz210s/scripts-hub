// runOnce 的福利书币接线:返回值里的 welfare 必须是这一步的结果,且完全离线可测。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { runOnce } from '../src/run.js'
import { readHistory } from '../src/state.js'

const NOW = new Date('2026-01-10T12:00:00')
const CREDENTIAL = { ok: true, renewed: false, changed: [], check: { name: '测试号' } }
const BOT = {
    ok: true, killed: false, exitCode: 0, seconds: 60, stderr: '',
    stdout: '实际阅读: 5分0秒\n成功请求: 1次\n失败请求: 0次\n'
}

/** 造一个离线运行目录:config.yaml(守卫与回写要动它)+ 固定窗口的 .env + data/。 */
function fixture() {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-run-'))
    fs.mkdirSync(path.join(cwd, 'data'), { recursive: true })
    fs.writeFileSync(path.join(cwd, 'config.yaml'), 'accounts:\n  - name: "旧名"\ntarget_duration: "1-2"\n', 'utf8')
    fs.writeFileSync(path.join(cwd, '.env'), [
        'QUIET_START=00:00',
        'QUIET_END=00:00',
        'SHUTDOWN_TIME=23:59',
        'SHUTDOWN_GUARD_MINUTES=1',
        'CHALLENGE_START=2026-01-01',
        'CHALLENGE_ENDS_ON=2026-01-30'
    ].join('\n'), 'utf8')
    return cwd
}

/** 官方统计回包:只关心今天的秒数。 */
function stats(todaySeconds) {
    return {
        ok: true,
        stats: {
            totalSeconds: todaySeconds, readDays: 1, dayAverageSeconds: todaySeconds, compare: null,
            buckets: [{ day: '2026-01-10', seconds: todaySeconds }], todaySeconds
        }
    }
}

/** 跑一次完整流程,联网依赖全部注入:不联网、不起 Python 进程。 */
async function runOffline({ claimWelfareOnce, beforeSeconds = 600, afterSeconds = 900 }) {
    const cwd = fixture()
    let reads = 0
    const result = await runOnce({
        cwd,
        now: NOW,
        deps: {
            ensureCredential: async () => CREDENTIAL,
            runBot: async () => BOT,
            // 第一次是开始前的读数,第二次是跑完的读数
            readStatsWithRetry: async () => stats(reads++ === 0 ? beforeSeconds : afterSeconds),
            claimWelfareOnce
        }
    })
    return { cwd, result }
}

test('runOnce:返回值里的 welfare 就是这一步的结果,并原样落进历史', async () => {
    const injected = { ok: true, claimed: true, coin: 3, key: 'k', reason: 'claimable', verifyOk: true, verified: true }
    const { cwd, result } = await runOffline({ claimWelfareOnce: async () => injected })

    assert.equal(result.welfare, injected)          // 直接透传这一步的结果,不换壳也不丢字段
    assert.equal(result.welfare.claimed, true)
    assert.equal(result.welfare.coin, 3)

    const latest = readHistory(path.join(cwd, 'data')).at(-1)
    assert.deepEqual(latest.welfare, { coin: 3, key: 'k', claimed: true, reason: 'claimable', verified: true, verifyOk: true })
    assert.equal(latest.welfare.claimed, true)

    // 阅读时长福利也跟着落盘:临时目录没有 secrets/* → ENOENT → no-credentials,claimed/failed 都为空
    assert.ok(latest.weekly)
    assert.deepEqual(latest.weekly.claimed, [])
    assert.deepEqual(latest.weekly.alreadyClaimed, [])
    assert.deepEqual(latest.weekly.failed, [])
    // 无档位可领时,日报里不该出现「阅读福利」
    assert.doesNotMatch(result.report, /阅读福利/)

    // 退出码只看官方统计读回(10 -> 15 分钟),不受福利结果影响
    assert.equal(result.beforeMinutes, 10)
    assert.equal(result.afterMinutes, 15)
    assert.equal(result.exitCode, 0)
})

test('runOnce:福利抛异常时运行照常结束,退出码与领到时一致', async () => {
    const { cwd, result } = await runOffline({ claimWelfareOnce: async () => { throw new Error('boom') } })

    assert.equal(result.exitCode, 0)                 // 与上一条同参数,退出码不变
    assert.equal(result.welfare.ok, false)
    assert.equal(result.welfare.claimed, false)
    assert.equal(result.welfare.reason, 'error')
    assert.match(result.welfare.error, /boom/)

    const latest = readHistory(path.join(cwd, 'data')).at(-1)
    assert.equal(typeof latest.welfare, 'object')    // 历史里是合法对象,不是 undefined
    assert.notEqual(latest.welfare, null)
    assert.deepEqual(latest.welfare, { coin: 0, key: '', claimed: false, reason: 'error', verified: false, verifyOk: false })
})

test('runOnce:退出码由官方统计决定,领到书币也不改变它', async () => {
    const injected = { ok: true, claimed: true, coin: 3, key: 'k', reason: 'claimable' }
    const { result } = await runOffline({ claimWelfareOnce: async () => injected, afterSeconds: 600 })

    assert.equal(result.afterMinutes, result.beforeMinutes)   // 官方一分钟都没增加
    assert.equal(result.exitCode, 1)
    assert.equal(result.welfare.claimed, true)                // 领到了,但退出码还是 1
})

test('runOnce:福利结果进运行日志,凭据拿不到时也留一行', async () => {
    const lines = []
    const original = console.log
    console.log = (...args) => lines.push(args.join(' '))
    try {
        await runOffline({ claimWelfareOnce: async () => ({ ok: true, claimed: false, coin: 0, key: '', reason: 'no-coin' }) })
        await runOffline({ claimWelfareOnce: async () => null })   // 拿不到 App 凭据
    } finally {
        console.log = original
    }

    const welfareLines = lines.filter(line => line.includes('[WELFARE]'))
    assert.equal(welfareLines.length, 2)
    assert.match(welfareLines[0], /reason=no-coin/)
    assert.match(welfareLines[0], /coin=0/)
    assert.match(welfareLines[0], /verified=false/)
    assert.match(welfareLines[1], /reason=no-credentials/)
})
