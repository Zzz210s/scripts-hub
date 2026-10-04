// 极简 JSON 存储:通知通道配置与积分历史都放在本目录的 data/ 下。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const DATA_DIR = path.join(root, 'data')

function resolve(name) {
    return path.join(DATA_DIR, `${name}.json`)
}

export function readStore(name, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(resolve(name), 'utf8'))
    } catch {
        return fallback
    }
}

export function writeStore(name, value) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const target = resolve(name)
    const tmp = `${target}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fs.renameSync(tmp, target)
}
