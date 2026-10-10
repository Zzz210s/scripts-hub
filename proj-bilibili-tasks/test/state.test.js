import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeAtomic } from '../src/atomic.js'
import { emptyState, loadState, saveState, setPaused, attemptsToday, recordAttempt, notifiedOnce, markNotified, setResult, appendCoinLedger, appendVoucher, LEDGER_KEEP } from '../src/state.js'

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-state-'))
const at = (text) => new Date(`2026-10-11T${text}:00`)

test('坏 JSON 回退空状态不抛', () => {
    const file = path.join(tmpdir, 'bad.json')
    fs.writeFileSync(file, '{not json')
    const { state, warnings } = loadState(file)
    assert.equal(state.lastRunDay, null)
    assert.equal(warnings.length, 1)
})

test('缺失文件 -> 空状态且无警告;非对象也叫回退', () => {
    assert.deepEqual(loadState(path.join(tmpdir, 'none.json')).warnings, [])
    const file = path.join(tmpdir, 'array.json')
    fs.writeFileSync(file, '[]')
    assert.equal(loadState(file).warnings.length, 1)
})

test('写后重读一致;原子写覆盖已存在文件', () => {
    const file = path.join(tmpdir, 'state.json')
    const { state } = loadState(file)
    setPaused(state, true)
    recordAttempt(state, at('10:00'))
    saveState(file, state, at('10:00'))
    const again = loadState(file).state
    assert.equal(again.paused, true)
    assert.equal(attemptsToday(again, at('10:00')), 1)
    recordAttempt(again, at('11:00'))
    saveState(file, again, at('11:00'))
    assert.equal(attemptsToday(loadState(file).state, at('11:00')), 2)
})

test('attempts 跨天归零', () => {
    const { state } = loadState(path.join(tmpdir, 'x.json'))
    recordAttempt(state, at('10:00'))
    assert.equal(attemptsToday(state, new Date('2026-10-12T10:00:00')), 0)
})

test('coinLedger / voucherHistory 剪枝到 90 条', () => {
    const { state } = loadState(path.join(tmpdir, 'y.json'))
    for (let i = 0; i < 95; i++) appendCoinLedger(state, { day: `d${i}` })
    for (let i = 0; i < 95; i++) appendVoucher(state, { day: `v${i}` })
    assert.equal(state.coinLedger.length, LEDGER_KEEP)
    assert.equal(state.voucherHistory.length, LEDGER_KEEP)
    assert.equal(state.coinLedger[0].day, 'd5')
})

test('notifiedOnce / markNotified / setResult', () => {
    const state = emptyState(at('10:00'))
    assert.equal(notifiedOnce(state, 'k', at('10:00')), false)
    markNotified(state, 'k', at('10:00'))
    assert.equal(notifiedOnce(state, 'k', at('10:00')), true)
    setResult(state, { day: '2026-10-11', result: 'success' })
    assert.equal(state.lastResult, 'success')
    assert.equal(state.lastRunDay, '2026-10-11')
})

test('rename 抛一次 EPERM 后重试成功', () => {
    const file = path.join(tmpdir, 'retry.txt')
    let calls = 0
    const fsImpl = {
        ...fs,
        renameSync(from, to) {
            calls += 1
            if (calls === 1) {
                const error = new Error('busy')
                error.code = 'EPERM'
                throw error
            }
            fs.renameSync(from, to)
        }
    }
    writeAtomic(file, 'hello', { fsImpl, sleep: () => {} })
    assert.equal(fs.readFileSync(file, 'utf8'), 'hello')
    assert.equal(calls, 2)
})

test('rename 一直 EPERM 时抛错并清掉临时文件', () => {
    const file = path.join(tmpdir, 'fail.txt')
    const fsImpl = { ...fs, renameSync() { const error = new Error('busy'); error.code = 'EPERM'; throw error } }
    assert.throws(() => writeAtomic(file, 'x', { fsImpl, retries: 1, sleep: () => {} }))
    assert.equal(fs.existsSync(`${file}.tmp-${process.pid}`), false)
})
