// 原子写:先写同目录临时文件再 rename。Windows 上目标被占用时 rename 会抛
// EPERM/EBUSY/EACCES,短暂自旋后重试(既有项目 2026-10-05 踩过)。
import fs from 'node:fs'
import path from 'node:path'

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])

export function writeAtomic(file, text, { fsImpl = fs, retries = 5, sleep } = {}) {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    fsImpl.writeFileSync(tmp, text, 'utf8')
    const wait = sleep ?? ((ms) => { const until = Date.now() + ms; while (Date.now() < until) { /* spin */ } })
    for (let attempt = 0; ; attempt++) {
        try {
            fsImpl.renameSync(tmp, file)
            return
        } catch (error) {
            if (!RETRYABLE.has(error?.code) || attempt >= retries) {
                try { fsImpl.rmSync(tmp, { force: true }) } catch { /* 清理失败无所谓 */ }
                throw error
            }
            wait(20)
        }
    }
}

/** 读 JSON;缺失返回 fallback 且 error 为空,坏了返回 fallback 并给出 error 消息。 */
export function readJsonSafe(file, fallback, { fsImpl = fs } = {}) {
    if (!fsImpl.existsSync(file)) return { value: fallback, error: null }
    try {
        return { value: JSON.parse(fsImpl.readFileSync(file, 'utf8')), error: null }
    } catch (error) {
        return { value: fallback, error: `${file} 不是合法 JSON:${error.message}` }
    }
}
