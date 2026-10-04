// 备份清单的读取与枚举:纯本地,不联网,不依赖 restic 是否安装。
//
// 清单在 config/backup.json;枚举结果给 scripts/backup.mjs 与 docs/infrastructure.md 用。
// 排除规则按「目录名」做(任意层级命中即跳过),这足以覆盖 node_modules / .venv / 缓存目录。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadPrivatePaths } from './schedule-targets.mjs'

/** 占位符取值表:环境变量优先,机器私有的 local-paths.env 补位。 */
export function placeholderValues(file) {
    const { values } = loadPrivatePaths(file)
    const fromEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === 'string'))
    return { ...values, ...fromEnv }
}

/**
 * 展开一个清单路径:`~` 到家目录,`%NAME%` 从取值表替换,再展开一次 `~`。
 * 取值表里没有的占位符保留原样(调用方会把它当成「缺失」报告,而不是默默指到一个不存在的目录)。
 */
export function expandPath(p, values = placeholderValues()) {
    let s = String(p).replace(/%([A-Z_][A-Z0-9_]*)%/g, (m, key) => values[key] ?? m)
    if (s.startsWith('~/') || s === '~') s = path.join(os.homedir(), s.slice(1))
    return path.normalize(s)
}

/** 清单里还没解开的占位符(非空说明本机 private 路径没填全)。 */
export function unresolved(paths) {
    return [...new Set(paths.flatMap((p) => [...String(p).matchAll(/%([A-Z_][A-Z0-9_]*)%/g)].map((m) => m[0])))]
}

/** 默认排除的目录名:任何层级出现就跳过。 */
export const DEFAULT_EXCLUDE_DIRS = [
    'node_modules',
    '__pycache__',
    '.venv',
    'venv',
    '.mypy_cache',
    '.pytest_cache',
    '.ruff_cache',
    '.codegraph',
    'ms-playwright',
    'logs',
    'tmp',
    '.cache'
]

/** 读清单:展开所有路径,并把默认排除项并进来。 */
export function loadManifest(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const values = placeholderValues()
    const sets = (raw.sets ?? []).map((set) => ({
        ...set,
        rawPaths: set.paths ?? [],
        paths: (set.paths ?? []).map((p) => expandPath(p, values)),
        excludePaths: (set.excludePaths ?? []).map((p) => expandPath(p, values))
    }))
    return { ...raw, sets, excludeDirs: [...DEFAULT_EXCLUDE_DIRS, ...(raw.excludeDirs ?? [])] }
}

/** 递归统计一个目录:文件数、总字节、目录数。权限错误只标记 deep=false,不抛。 */
export function walk(root, { excludeDirs, excludePaths = [] }) {
    const skipNames = new Set(excludeDirs)
    const skipAbs = new Set(excludePaths)
    const out = { files: 0, bytes: 0, dirs: 0, deep: true }
    const stack = [root]
    while (stack.length) {
        const dir = stack.pop()
        let entries
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
            out.deep = false
            continue
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                if (skipNames.has(entry.name) || skipAbs.has(full)) continue
                out.dirs += 1
                stack.push(full)
            } else if (entry.isFile()) {
                out.files += 1
                try {
                    out.bytes += fs.statSync(full).size
                } catch {
                    /* 竞态:文件在枚举期间消失 */
                }
            }
        }
    }
    return out
}

/**
 * 逐集合、逐路径枚举。返回 [{ ...set, entries: [{ path, exists, kind, files, bytes }] }]。
 * only 限定单个 set id;includeOptional 决定是否枚举 optional 集合。
 */
export function inspect(manifest, { includeOptional = false, only = null } = {}) {
    const rows = []
    for (const set of manifest.sets) {
        if (only && set.id !== only) continue
        if (set.optional && !includeOptional) {
            rows.push({ ...set, skipped: 'optional', entries: [] })
            continue
        }
        const entries = set.paths.map((p) => {
            if (!fs.existsSync(p)) return { path: p, exists: false, kind: 'missing', files: 0, bytes: 0 }
            const stat = fs.statSync(p)
            if (!stat.isDirectory()) {
                return { path: p, exists: true, kind: 'file', files: 1, bytes: stat.size, dirs: 0, deep: true }
            }
            return { path: p, exists: true, kind: 'dir', ...walk(p, { excludeDirs: manifest.excludeDirs, excludePaths: set.excludePaths }) }
        })
        rows.push({ ...set, entries })
    }
    return rows
}

/** 人类可读体积。 */
export function human(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let n = Number(bytes) || 0
    let i = 0
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024
        i += 1
    }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)}${units[i]}`
}

/** 汇总一组 rows。 */
export function totals(rows) {
    const sources = rows.flatMap((row) => row.entries ?? [])
    return {
        sets: rows.length,
        sources: sources.length,
        present: sources.filter((e) => e.exists).length,
        missing: sources.filter((e) => !e.exists).length,
        files: sources.reduce((a, e) => a + (e.exists ? e.files : 0), 0),
        bytes: sources.reduce((a, e) => a + (e.exists ? e.bytes : 0), 0)
    }
}
