// 运行状态与历史:JSON + 原子写。状态按"本地日"滚动,跨天自动重置。
import fs from 'node:fs'
import path from 'node:path'

import { writeJsonAtomic } from './atomic.js'
import { localDay } from './plan.js'

const HISTORY_LIMIT = 200

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
        return fallback
    }
}

export function emptyState(today = localDay()) {
    return { date: today, todayMinutes: 0, targetMinutes: 0, attempts: 0, done: false, lastRunAt: null, lastOutcome: null }
}

export function readState(rootDir = 'data', now = new Date()) {
    const state = readJson(path.join(rootDir, 'state.json'), null)
    const today = localDay(now)
    if (!state || state.date !== today) return emptyState(today)
    return { ...emptyState(today), ...state }
}

export function writeState(state, rootDir = 'data') {
    writeJsonAtomic(path.join(rootDir, 'state.json'), state)
}

export function isPaused(rootDir = 'data') {
    return fs.existsSync(path.join(rootDir, 'paused'))
}

export function setPaused(paused, rootDir = 'data') {
    const file = path.join(rootDir, 'paused')
    if (paused) {
        fs.mkdirSync(rootDir, { recursive: true })
        fs.writeFileSync(file, `paused at ${new Date().toISOString()}\n`, 'utf8')
    } else if (fs.existsSync(file)) {
        fs.unlinkSync(file)
    }
    return paused
}

export function appendHistory(record, rootDir = 'data') {
    const file = path.join(rootDir, 'history.json')
    const history = readJson(file, [])
    history.push(record)
    writeJsonAtomic(file, history.slice(-HISTORY_LIMIT))
}

export function readHistory(rootDir = 'data') {
    return readJson(path.join(rootDir, 'history.json'), [])
}

/** 一次运行结束后更新当日状态:达标即标记完成,未达标则累加尝试次数。 */
export function recordRun(state, { minutes, targetMinutes, outcome, at = new Date() }) {
    const next = { ...state, attempts: state.attempts + 1, lastRunAt: at.toISOString(), lastOutcome: outcome }
    next.todayMinutes = Math.max(state.todayMinutes, minutes)
    next.targetMinutes = targetMinutes
    next.done = next.todayMinutes >= targetMinutes
    return next
}

/**
 * 只刷新分钟数与达标标记,**不**累加 attempts。
 * 用于会话循环结束后用最终官方进度补记一次 —— 每个会话已经各自计过一次 attempts,
 * 这里再加就多算了(2026-10-05 加循环时补的)。
 */
export function recordMinutes(state, { minutes, targetMinutes }) {
    const next = { ...state }
    next.todayMinutes = Math.max(state.todayMinutes, minutes)
    next.targetMinutes = targetMinutes ?? state.targetMinutes
    next.done = next.todayMinutes >= next.targetMinutes
    return next
}
