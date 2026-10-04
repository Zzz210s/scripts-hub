// 从微信读书 APK 的 DEX 里扫出所有像 API 路径的字符串,用来找出"福利/领书币"的接口名。
//
//   node tools/scan-apk-paths.mjs <apk 路径> [关键词...]
//
// 原理:DEX 里的字符串是明文 UTF-8(带长度前缀),直接按字节扫就能拿到;不用反编译工具。
// 只输出路径形态的字符串,不输出任何密钥类内容。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const apk = process.argv[2]
const keywords = process.argv.slice(3)
if (!apk || !fs.existsSync(apk)) {
    console.log('用法:node tools/scan-apk-paths.mjs <apk> [关键词...]')
    process.exit(1)
}

// 用 unzip 列出 dex(避免引入 zip 依赖);Windows 的 Git Bash 自带 unzip,失败则用 tar 兜底
function listDex(file) {
    try {
        return execFileSync('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
            .split(/\r?\n/).filter(name => /^classes\d*\.dex$/.test(name))
    } catch {
        return execFileSync('tar', ['-tf', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
            .split(/\r?\n/).filter(name => /classes\d*\.dex$/.test(name))
    }
}

function readEntry(file, name) {
    const out = execFileSync('unzip', ['-p', file, name], { maxBuffer: 512 * 1024 * 1024 })
    return out
}

const pathPattern = /^\/[a-zA-Z][a-zA-Z0-9_/]{2,60}$/
const found = new Map()
const dexFiles = listDex(apk)
console.log(`APK 里的 dex:${dexFiles.join(', ')}`)

for (const name of dexFiles) {
    const buffer = readEntry(apk, name)
    const text = buffer.toString('latin1')   // 逐字节扫描,避免 UTF-8 截断
    for (const match of text.matchAll(/[\x20-\x7e]{4,80}/g)) {
        const candidate = match[0]
        if (!pathPattern.test(candidate)) continue
        if (!found.has(candidate)) found.set(candidate, name)
    }
}

const all = [...found.keys()].sort()
console.log(`共扫出 ${all.length} 个路径形态的字符串`)

if (keywords.length) {
    const hits = all.filter(p => keywords.some(k => p.toLowerCase().includes(k.toLowerCase())))
    console.log(`\n命中关键词(${keywords.join(', ')})的路径 ${hits.length} 个:`)
    for (const hit of hits) console.log('  ' + hit)
} else {
    console.log('\n前 200 个:')
    for (const item of all.slice(0, 200)) console.log('  ' + item)
}

// 顺带把包含福利类中文关键词附近的路径挑出来(中文在 DEX 里是 UTF-8,需单独解)
const zh = ['福利', '签到', '书币', '领取', '体验卡', '翻一翻', '答题', '抽奖', '任务', '奖励']
const bufferAll = dexFiles.map(name => readEntry(apk, name)).join('')   // eslint-disable-line no-unused-vars
const utf8 = Buffer.concat(dexFiles.map(name => readEntry(apk, name))).toString('utf8')
console.log('\n中文关键词出现次数:')
for (const word of zh) {
    const count = utf8.split(word).length - 1
    if (count) console.log(`  ${word}: ${count}`)
}
console.log(`\n(临时目录:${path.dirname(apk)})`)
