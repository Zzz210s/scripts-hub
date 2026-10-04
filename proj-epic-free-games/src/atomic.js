// 原子写 JSON:先写同目录的临时文件再 rename,避免进程被杀时留下半个文件。
import fs from 'node:fs'
import path from 'node:path'

export function writeAtomic(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, text, 'utf8')
    try {
        fs.renameSync(tmp, file)
    } catch (error) {
        fs.rmSync(tmp, { force: true })
        throw error
    }
}

/** 读 JSON;缺失返回 fallback 且 error 为空,坏了返回 fallback 并给出 error 消息。 */
export function readJsonSafe(file, fallback) {
    if (!fs.existsSync(file)) return { value: fallback, error: null }
    try {
        return { value: JSON.parse(fs.readFileSync(file, 'utf8')), error: null }
    } catch (error) {
        return { value: fallback, error: `${file} 不是合法 JSON:${error.message}` }
    }
}
