#!/usr/bin/env node
// 漂移检测:同一份核心代码在多个实现里各自内嵌时,必须彼此逐字节一致(按 LF 归一后比对,
// 不受 checkout 行尾影响)。规则见 docs/wecom-rules.md;不一致就报错并退出 1。
//
// 用法:node scripts/check-wecom-drift.mjs
//       node scripts/check-wecom-drift.mjs --verbose   打印各块大小与首个差异位置
//
// 为什么不用跨目录 import:这些是无人值守的计划任务,各自独立部署,
// 改运行时依赖风险高;所以这里用「各实现内嵌同一块 + 漂移检测」。
//
// 两组:
//   wecom-core   Node 侧的发送核心(postWecom 等),4 份
//   wecom-notify 通知脚本里的 python 发送块,3 份(本机 helper + 两个 Linux 侧实现)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const GROUPS = [
    {
        name: 'wecom-core',
        begin: '// >>> wecom-core begin',
        end: '// <<< wecom-core end',
        files: [
            'proj-microsoft-rewards/wechat-bridge/lib/wecom.js',
            'proj-weread-signin/src/notify.js',
            'proj-epic-free-games/src/notify.js',
            'proj-bilibili-tasks/src/notify.js'
        ]
    },
    {
        name: 'wecom-notify',
        begin: '# >>> wecom-notify begin',
        end: '# <<< wecom-notify end',
        files: [
            'scripts/note-sync/notify-wecom.sh',
            'scripts/linux/note-sync/note-sync.sh',
            'scripts/linux/mem-guard/mem-guard.sh'
        ]
    }
]

/** 取出 begin 到 end 之间(含两行标记)的整块源码。 */
function extractCore(relative, begin, end) {
    const absolute = path.join(ROOT, relative)
    let text
    try {
        // 归一 CRLF:Windows 上 core.autocrlf=true 的克隆会把行尾改成 CRLF,
        // 而仓库里 .gitattributes 未覆盖的文件与覆盖的(proj-microsoft-rewards/)会不一致
        text = fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n')
    } catch (error) {
        throw new Error(`读不到 ${relative}:${error.message}`)
    }

    const at = text.indexOf(begin)
    const stop = text.indexOf(end)
    if (at === -1 || stop === -1 || stop < at) {
        throw new Error(`${relative} 缺少 ${begin} 标记(需要它与 ${end})`)
    }

    const endOfLine = text.indexOf('\n', stop)
    return text.slice(at, endOfLine === -1 ? text.length : endOfLine)
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
let failed = false

for (const group of GROUPS) {
    let cores
    try {
        cores = group.files.map(relative => ({ relative, core: extractCore(relative, group.begin, group.end) }))
    } catch (error) {
        process.stderr.write(`[wecom-drift] ${group.name}: ${error.message}\n`)
        failed = true
        continue
    }

    if (verbose) {
        for (const { relative, core } of cores) {
            process.stdout.write(`[wecom-drift] ${group.name} · ${relative}: ${Buffer.byteLength(core, 'utf8')} 字节\n`)
        }
    }

    const [base, ...others] = cores
    for (const { relative, core } of others) {
        if (core === base.core) continue
        failed = true
        process.stderr.write(`[wecom-drift] 漂移:${group.name} · ${relative} —— 核心块与 ${base.relative} 不一致\n`)
        if (verbose) {
            const at = firstDiff(base.core, core)
            process.stderr.write(`              首个差异:${base.relative} 第 ${lineOf(base.core, at)} 行附近\n`)
        }
        process.stderr.write(`              请把 ${base.relative} 的核心块整段复制过去\n`)
    }

    if (!failed) {
        process.stdout.write(`[wecom-drift] 通过:${group.name} ${cores.length} 份彼此一致\n`)
    }
}

if (failed) {
    process.stderr.write('[wecom-drift] 失败:同一份核心代码的多个内嵌副本必须一致(规则见 docs/wecom-rules.md)\n')
    process.exit(1)
}

process.stdout.write('[wecom-drift] 全部通过(忽略行尾;规则见 docs/wecom-rules.md)\n')
