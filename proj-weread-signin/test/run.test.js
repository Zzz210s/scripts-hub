import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { parseBotOutput, parseBotResult, peerBusy } from '../src/run.js'

test('peerBusy:以同伴的 lock-status 为准,残锁不挡,查不通才按年龄兜底', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-peer-'))
    const lock = path.join(dir, 'logs', 'run.lock')
    const check = path.join(dir, 'scripts', 'windows', 'run-state.js')
    assert.equal(peerBusy([lock], { exec: () => 'RUNNING' }).busy, false)   // 没有锁文件 = 没在跑

    fs.mkdirSync(path.dirname(lock), { recursive: true })
    fs.mkdirSync(path.dirname(check), { recursive: true })
    fs.writeFileSync(check, '// stub', 'utf8')
    fs.writeFileSync(lock, '', 'utf8')                                     // 同伴的锁是空文件(实测)

    const running = peerBusy([lock], { exec: () => 'RUNNING\n' })
    assert.equal(running.busy, true)
    assert.match(running.detail, /正在运行/)
    assert.match(running.detail, /已 \d+ 分钟/)

    assert.equal(peerBusy([lock], { exec: () => 'STALE\n' }).busy, false)   // 残锁不该挡路
    assert.equal(peerBusy([lock], { exec: () => 'NONE\n' }).busy, false)

    // 查不通:很新的锁保守让路,超过 10 分钟就放行
    assert.equal(peerBusy([lock], { exec: () => { throw new Error('超时') } }).busy, true)
    assert.equal(peerBusy([lock], { exec: () => { throw new Error('超时') }, now: Date.now() + 3600000 }).busy, false)
    assert.equal(peerBusy([]).busy, false)
})

test('parseBotOutput 从底座输出里取时长与请求数', () => {
    const parsed = parseBotOutput('⏱️ 实际阅读: 3分48秒\n✅ 成功请求: 3次\n❌ 失败请求: 0次')
    assert.equal(parsed.reportedSeconds, 228)
    assert.equal(parsed.requests, 3)
    assert.equal(parsed.failures, 0)
})

test('parseBotResult 输出为空时回落到底座日志', () => {
    const parsed = parseBotResult({ stdout: '', stderr: '', logFile: 'test/fixtures/bot-log-sample.txt' })
    assert.equal(parsed.reportedSeconds, 228)
    assert.equal(parsed.requests, 3)
})
