#!/usr/bin/env node
// 漂移检测:三份企业微信发送实现(wecom-notify / wechat-bridge / weread-signin)
// 里标了 `wecom-core` 的核心块必须逐字节一致。不一致就报错并退出 1。
//
// 用法:node scripts/check-wecom-drift.mjs
//       node scripts/check-wecom-drift.mjs --verbose   打印各文件块大小
//
// 为什么不用跨目录 import:两个程序是无人值守的计划任务,各自独立部署,
// 改运行时依赖风险高;所以这里用「一份权威 + 副本对齐 + 漂移检测」。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BEGIN = '// >>> wecom-core begin'
const END = '// <<< wecom-core end'

/** 三份副本:第一份是权威实现,其余两份必须与它一致。 */
const FILES = [
    'wecom-notify/src/wecom.js',
    'microsoft-rewards/wechat-bridge/lib/wecom.js',
    'weread-signin/src/notify.js'
]

/** 取出 `wecom-core begin` 到 `wecom-core end` 之间(含两行标记)的整块源码。 */
function extractCore(relative) {
    const absolute = path.join(ROOT, relative)
    let text
    try {
        text = fs.readFileSync(absolute, 'utf8')
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

const verbose = process.argv.includes('--verbose')
let cores
try {
    cores = FILES.map(relative => ({ relative, core: extractCore(relative) }))
} catch (error) {
    process.stderr.write(`[wecom-drift] ${error.message}\n`)
    process.exit(1)
}

const [authority, ...copies] = cores
if (verbose) {
    for (const { relative, core } of cores) {
        process.stdout.write(`[wecom-drift] ${relative}: ${Buffer.byteLength(core, 'utf8')} 字节\n`)
    }
}

let drifted = false
for (const { relative, core } of copies) {
    if (core === authority.core) continue
    drifted = true
    const reason = core.includes(BEGIN)
        ? '核心块与权威版不一致'
        : '核心块缺失'
    process.stderr.write(`[wecom-drift] 漂移:${relative} —— ${reason}\n`)
    process.stderr.write(`              请把 ${authority.relative} 的核心块整段复制过去\n`)
}

if (drifted) {
    process.stderr.write('[wecom-drift] 失败:三份企业微信发送核心必须一致\n')
    process.exit(1)
}

process.stdout.write(`[wecom-drift] 通过:${FILES.length} 份核心块逐字节一致(权威 ${authority.relative})\n`)
