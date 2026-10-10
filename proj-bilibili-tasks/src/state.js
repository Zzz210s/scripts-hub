// 本地状态:上次运行日、当天次数、硬币台账、券历史、暂停位。原子写;坏 JSON 回退空状态不抛。
import { readJsonSafe, writeAtomic } from './atomic.js'
import { dayKey } from './clock.js'

export const STATE_VERSION = 1
export const LEDGER_KEEP = 90

export function emptyState(now = new Date()) {
    return {
        version: STATE_VERSION,
        updatedAt: now.toISOString(),
        paused: false,
        account: '',
        lastRunDay: null,
        lastResult: null,
        days: {},            // { 'YYYY-MM-DD': { attempts, notified, checkedAt } }
        coinLedger: [],      // [{ day, balance, target, stop }]
        voucherHistory: []   // [{ day, action, state, expireTime, nextReceiveDays }]
    }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function loadState(file) {
    const { value, error } = readJsonSafe(file, null)
    if (error) return { state: emptyState(), warnings: [error] }
    if (value === null) return { state: emptyState(), warnings: [] }
    if (!isObject(value)) return { state: emptyState(), warnings: [`${file} 不是对象,已回退空状态`] }
    return {
        state: {
            version: STATE_VERSION,
            updatedAt: value.updatedAt,
            paused: value.paused === true,
            account: typeof value.account === 'string' ? value.account : '',
            lastRunDay: typeof value.lastRunDay === 'string' ? value.lastRunDay : null,
            lastResult: value.lastResult === 'success' || value.lastResult === 'failure' ? value.lastResult : null,
            days: isObject(value.days) ? value.days : {},
            coinLedger: Array.isArray(value.coinLedger) ? value.coinLedger : [],
            voucherHistory: Array.isArray(value.voucherHistory) ? value.voucherHistory : []
        },
        warnings: []
    }
}

export function saveState(file, state, now = new Date()) {
    state.updatedAt = now.toISOString()
    writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`)
}

export const setPaused = (state, value) => { state.paused = value === true }

const today = (state, now, boundaryHour) => (state.days[dayKey(now, boundaryHour)] ??= { attempts: 0, notified: {}, checkedAt: null })

export const attemptsToday = (state, now = new Date(), boundaryHour = 4) => today(state, now, boundaryHour).attempts

export function recordAttempt(state, now = new Date(), boundaryHour = 4) {
    const day = today(state, now, boundaryHour)
    day.attempts += 1
    day.checkedAt = now.toISOString()
    return day.attempts
}

export const notifiedOnce = (state, key, now = new Date(), boundaryHour = 4) => Boolean(today(state, now, boundaryHour).notified?.[key])

export function markNotified(state, key, now = new Date(), boundaryHour = 4) {
    const day = today(state, now, boundaryHour)
    day.notified = { ...(day.notified ?? {}), [key]: now.toISOString() }
}

export function setResult(state, { day, result }) {
    state.lastRunDay = day
    state.lastResult = result
}

export function appendCoinLedger(state, entry) {
    state.coinLedger.push(entry)
    if (state.coinLedger.length > LEDGER_KEEP) state.coinLedger = state.coinLedger.slice(-LEDGER_KEEP)
}

export function appendVoucher(state, entry) {
    state.voucherHistory.push(entry)
    if (state.voucherHistory.length > LEDGER_KEEP) state.voucherHistory = state.voucherHistory.slice(-LEDGER_KEEP)
}
