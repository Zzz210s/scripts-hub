#!/usr/bin/env node
// 漂移检测:各项目里标了 `wecom-core` 的核心块必须彼此逐字节一致(按 LF 归一后比对,不受
// checkout 行尾影响)。规则见 docs/wecom-rules.md;不一致就报错并退出 1。
//
// 用法:node scripts/check-wecom-drift.mjs
//       node scripts/check-wecom-drift.mjs --verbose   打印各块大小与首个差异位置
//
// 为什么不用跨目录 import:这些是无人值守的计划任务,各自独立部署,
// 改运行时依赖风险高;所以这里用「各实现内嵌同一块 + 漂移检测」。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BEGIN = '// >>> wecom-core begin'
const END = '// <<< wecom-core end'

/** 各实现:核心块必须彼此一致。 */
const FILES = [
    'proj-microsoft-rewards/wechat-bridge/lib/wecom.js',
    'proj-weread-signin/src/notify.js',
    'proj-epic-free-games/src/notify.js'
]

/** 取出 `wecom-core begin` 到 `wecom-core end` 之间(含两行标记)的整块源码。 */
function extractCore(relative) {
    const absolute = path.join(ROOT, relative)
    let text
    try {
        // 归一 CRLF:Windows 上 core.autocrlf=true 的克隆会把行尾改成 CRLF,
        // 而仓库里 .gitattributes 未覆盖的文件与覆盖的(proj-microsoft-rewards/)会不一致
        text = fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n')
    } catch (error) {
        throw new Error(`读不到 ${relative}:${error.message}`)
    }

    const begin = text.indexOf(BEGIN)
    const end = text.indexOf(END)
    if (begin === -1 || end === -1 || end < begin) {
        throw new Error(`${relative} 缺少 wecom-core 标记(需要 ${BEGIN} 与 ${END})`)
    }

    const endOfLine = text.indexOf('\n', end)
    return text.slice(begin, endOfLine === -1 ? text.length : endOfLine)
}

/** 首个不同字符的下标;完全相同返回 -1。 */
function firstDiff(a, b) {
    const max = Math.min(a.length, b.length)
    for (let i = 0; i < max; i++) {
        if (a[i] !== b[i]) return i
    }
    return a.length === b.length ? -1 : max
}

/** 把字符下标换算成 `第 N 行`(1 起);下标为 -1 时返回 null。 */
function lineOf(text, index) {
    if (index < 0) return null
    return text.slice(0, index).split('\n').length
}

const verbose = process.argv.includes('--verbose')
let cores
try {
    cores = FILES.map(relative => ({ relative, core: extractCore(relative) }))
} catch (error) {
    process.stderr.write(`[wecom-drift] ${error.message}\n`)
    process.exit(1)
}

if (verbose) {
    for (const { relative, core } of cores) {
        process.stdout.write(`[wecom-drift] ${relative}: ${Buffer.byteLength(core, 'utf8')} 字节\n`)
    }
}

const [base, ...others] = cores
let drifted = false
for (const { relative, core } of others) {
    if (core === base.core) continue
    drifted = true
    const reason = core.includes(BEGIN) ? '核心块与基准不一致' : '核心块缺失'
    process.stderr.write(`[wecom-drift] 漂移:${relative} —— ${reason}\n`)
    if (verbose) {
        const at = firstDiff(base.core, core)
        process.stderr.write(`              首个差异:${base.relative} 第 ${lineOf(base.core, at)} 行附近\n`)
    }
    process.stderr.write(`              请把 ${base.relative} 的核心块整段复制过去\n`)
}

if (drifted) {
    process.stderr.write('[wecom-drift] 失败:各实现的 wecom-core 核心块必须一致(规则见 docs/wecom-rules.md)\n')
    process.exit(1)
}

process.stdout.write(`[wecom-drift] 通过:${FILES.length} 份核心块彼此一致(忽略行尾;规则见 docs/wecom-rules.md)\n`)
