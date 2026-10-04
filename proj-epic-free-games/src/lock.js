// 单实例锁与同伴互查:锁文件里只放 pid 与开始时间,判定以「进程是否真的在跑」为准,
// 崩溃留下的残锁立即回收(否则会挡住当天所有重试)。
import fs from 'node:fs'
import path from 'node:path'

export const lockFile = (root) => path.join(root, 'logs', 'run.lock')

export function readLock(file) {
    try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'))
        return value && typeof value === 'object' ? value : null
    } catch {
        return null
    }
}

export function writeLock(file, now = new Date()) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: now.toISOString() }), 'utf8')
    return { pid: process.pid, startedAt: now.toISOString() }
}

export const clearLock = (file) => fs.rmSync(file, { force: true })

export const defaultIsAlive = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return error?.code === 'EPERM'
    }
}

/** NONE 没有锁 / RUNNING 有活进程 / STALE 残锁(顺带删掉)。 */
export function lockStatus(file, isAlive = defaultIsAlive) {
    if (!fs.existsSync(file)) return 'NONE'
    const lock = readLock(file)
    if (lock && isAlive(lock.pid)) return 'RUNNING'
    clearLock(file)
    return 'STALE'
}

/** 同伴程序是否在跑:给定的锁文件里有一个是「新写的」就算。
 *  各程序的运行器写的是标记锁(run-state.js 写完就退出),所以这里看锁的年龄而不是那个 pid; */
export function peerRunning(files = [], { now = new Date(), maxAgeMinutes = 90 } = {}) {
    for (const file of files) {
        if (!fs.existsSync(file)) continue
        const startedAt = Date.parse(readLock(file)?.startedAt ?? '')
        if (Number.isNaN(startedAt)) continue
        if (now.getTime() - startedAt <= maxAgeMinutes * 60000) return true
    }
    return false
}
