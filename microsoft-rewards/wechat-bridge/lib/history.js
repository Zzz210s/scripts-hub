// Rolling history of points totals so notifications can show the cumulative
// balance even when a run fails before reading it.
import { readStore, writeStore } from './store.js'

const LIMIT = 200

/** 同一次运行的记录指纹:同一天 + 同一账号 + 同样的前后余额视为同一条。 */
function fingerprint(entry) {
    return `${entry.day ?? ''}|${entry.account}|${entry.before}|${entry.balance}|${entry.gained}`
}

export function readHistory() {
    const list = readStore('points-history', [])
    return Array.isArray(list) ? list : []
}

/** Most recent record for an account (or overall when account is omitted). */
export function lastKnown(account) {
    const list = readHistory()
    for (let i = list.length - 1; i >= 0; i--) {
        if (!account || list[i].account === account) return list[i]
    }
    return null
}

export function recordRun(entries) {
    const list = readHistory()
    const seen = new Set(list.map(fingerprint))
    let added = 0

    for (const entry of entries) {
        const record = { at: new Date().toISOString(), ...entry }
        // 同一条运行结果可能被重复推送(手工补发、重跑同一份日志),只记一次
        if (seen.has(fingerprint(record))) continue
        seen.add(fingerprint(record))
        list.push(record)
        added += 1
    }

    if (added) writeStore('points-history', list.slice(-LIMIT))
    return added
}
