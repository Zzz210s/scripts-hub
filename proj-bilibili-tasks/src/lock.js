// 单实例锁与同伴互查:自己的锁按 pid 判活;同伴的锁按年龄判活
// (同伴锁由宿主 run.sh 写,它记的 pid 在容器的 PID 命名空间里译不过去)。
import fs from 'node:fs'
import path from 'node:path'

export const lockFile = (root) => path.join(root, 'data', 'run.lock')

export function readLock(file) {
    try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'))
        return value && typeof value === 'object' ? value : null
    } catch {
        return null
    }
}

export const defaultIsAlive = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return error?.code === 'EPERM'
    }
}

export function writeLock(file, now = new Date(), pid = process.pid) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const value = { pid, startedAt: now.toISOString() }
    fs.writeFileSync(file, JSON.stringify(value), 'utf8')
    return value
}

export const clearLock = (file) => fs.rmSync(file, { force: true })

/** 已有活着的持有者 -> 拿不到;残锁直接接管(否则崩溃留下的锁会挡住当天所有重试)。 */
export function acquireLock(file, { now = new Date(), isAlive = defaultIsAlive, pid = process.pid } = {}) {
    if (fs.existsSync(file)) {
        const holder = readLock(file)
        if (holder && isAlive(holder.pid)) return { ok: false, holder }
        clearLock(file)
        writeLock(file, now, pid)
        return { ok: true, stale: true }
    }
    writeLock(file, now, pid)
    return { ok: true, stale: false }
}

const ageMinutes = (file, now) => {
    const startedAt = Date.parse(readLock(file)?.startedAt ?? '')
    const stamp = Number.isNaN(startedAt) ? fs.statSync(file).mtimeMs : startedAt
    return (now.getTime() - stamp) / 60000
}

/** 同伴程序是否在跑:任一锁文件的年龄在 maxAgeMinutes 内就算。 */
export function peerRunning(files = [], { now = new Date(), maxAgeMinutes = 90 } = {}) {
    for (const file of files) {
        if (!fs.existsSync(file)) continue
        try {
            if (ageMinutes(file, now) <= maxAgeMinutes) return true
        } catch { /* 读不到这个锁,看下一个 */ }
    }
    return false
}
