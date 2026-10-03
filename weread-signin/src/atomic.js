// 原子写:先写临时文件再 rename,避免读到半截文件。
//
// Windows 上 rename 覆盖已存在的文件时,如果那一刻被杀毒/索引服务占用,
// 会偶发 EPERM/EBUSY(实测会让单元测试随机失败一次)。这里做几次短重试。
import fs from 'node:fs'
import path from 'node:path'

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

export function writeTextAtomic(file, text, { attempts = 5 } = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, text, 'utf8')
    let lastError
    for (let index = 0; index < attempts; index += 1) {
        try {
            fs.renameSync(tmp, file)
            return
        } catch (error) {
            lastError = error
            if (!RETRY_CODES.has(error.code)) break
            // 同步睡眠:写状态是很短的临界区,不值得为此改成异步
            const until = Date.now() + 25 * (index + 1)
            while (Date.now() < until) { /* 自旋等待 */ }
        }
    }
    fs.rmSync(tmp, { force: true })
    throw lastError
}

export function writeJsonAtomic(file, value, options) {
    writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`, options)
}
