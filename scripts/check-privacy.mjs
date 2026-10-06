#!/usr/bin/env node
//
// check-privacy:扫仓库**已跟踪文件**里的个人标识与明文凭据,命中即退出 1。
// 与 sync-microsoft-rewards.sh 的发布前脱敏是两道独立防线:那道管快照内容,这道管整个仓库。
// 规则表在 scripts/lib/privacy-rules.mjs —— 与"push 前闸门"共用同一份实现。
//
// 用法:node scripts/check-privacy.mjs [--verbose] [--staged] [--files-from=<清单文件>]
//   --verbose        连通过项也打印
//   --staged         只扫已暂存(git diff --cached)的文件 —— push 前闸门用这个,快且准
//   --files-from=F   只扫 F 里列出的文件(一行一个,相对仓库根)
//
// 机器私有标识(真实姓名/邮箱/主机名/用户名)从 ~/.config/automation-suite/sensitive-patterns.txt
// 读取(一行一个,仓库外,永不入库);读不到就只跑通用规则。可用 SENSITIVE_PATTERNS_FILE 覆盖位置。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { FORBIDDEN_PATH_RULES, rulesWithPrivate } from './lib/privacy-rules.mjs'

const repo = path.resolve(import.meta.dirname, '..')
// 本文件与规则表自身含允许清单里的字面量,只对它们跳过「私有标识」规则(通用规则照跑)
// 规则表自身、以及它的回归测试(测试里全是**假**样例:hunter2 / EXAMPLE / xxxxxxxx),
// 这些文件必须含“看起来像凭据”的字符串,否则测不出规则是否有效。
const SELF_FILES = new Set([
    'scripts/check-privacy.mjs',
    'scripts/lib/privacy-rules.mjs',
    'scripts/test/privacy-rules.test.mjs'
])
const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const staged = args.includes('--staged')
const filesFrom = args.find((a) => a.startsWith('--files-from='))?.slice('--files-from='.length)

const sensitiveFile = process.env.SENSITIVE_PATTERNS_FILE ?? path.join(homedir(), '.config', 'automation-suite', 'sensitive-patterns.txt')
const privatePatterns = []
if (existsSync(sensitiveFile)) {
    for (const raw of readFileSync(sensitiveFile, 'utf8').split(/\r?\n/)) {
        const line = raw.trim()
        if (line && !line.startsWith('#')) privatePatterns.push(line)
    }
}
const { rules } = rulesWithPrivate(privatePatterns)

function listFiles() {
    if (filesFrom) {
        return readFileSync(filesFrom, 'utf8')
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
    }
    const gitArgs = staged ? ['diff', '--cached', '--name-only', '-z'] : ['ls-files', '-z']
    return execFileSync('git', gitArgs, { cwd: repo, maxBuffer: 1 << 26 }).toString().split('\0').filter(Boolean)
}

function isText(buf) {
    return !buf.subarray(0, 4096).includes(0)
}

const files = listFiles()
let findings = 0
const fileNameHits = []

outer: for (const rel of files) {
    // 自测夹具整份跳过:里面全是**假**样例(hunter2 / EXAMPLE / mongodb://admin:hunter2@),
    // 规则表与它的测试天然要含"看起来像凭据"的字符串。
    if (SELF_FILES.has(rel)) continue
    for (const [re, why] of FORBIDDEN_PATH_RULES) {
        if (re.test(rel)) {
            findings++
            console.log(`命中  ${rel}  [${why}]`)
            continue outer
        }
    }
    for (const [name, , , literal] of rules) {
        if (literal && rel.includes(literal)) fileNameHits.push(`${rel}  文件名含「${name}」`)
    }

    let text
    try {
        const buf = readFileSync(path.join(repo, rel))
        if (!isText(buf)) continue
        text = buf.toString('utf8')
    } catch {
        continue
    }

    const lines = text.split(/\r?\n/)
    for (const [name, re, allow, literal] of rules) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (literal) {
                if (SELF_FILES.has(rel)) continue
                // 公开提交身份允许出现:私有清单里的 handle 命中公开提交邮箱时不算泄漏
                const probe = line.replace(/zzz210s@qq\.com/gi, '')
                if (!probe.includes(literal)) continue
                findings++
                console.log(`命中  ${rel}:${i + 1}  [${name}]  ${probe.trim().slice(0, 120)}`)
                continue
            }
            const m = re.exec(line)
            if (!m) continue
            const hit = m[0].trim()
            if (allow && allow(hit)) continue
            findings++
            console.log(`命中  ${rel}:${i + 1}  [${name}]  ${hit.slice(0, 80)}`)
        }
    }
}
for (const hit of fileNameHits) {
    findings++
    console.log(`命中  ${hit}`)
}

const scope = staged ? '已暂存文件' : filesFrom ? `清单里的 ${files.length} 个文件` : `${files.length} 个已跟踪文件`
if (findings) {
    console.log(`\n结论:${scope}中发现 ${findings} 处待复核(上方逐条列出)。私有清单:${existsSync(sensitiveFile) ? sensitiveFile : '未找到(只跑了通用规则)'}`)
    process.exit(1)
}
console.log(`通过:${scope}未发现个人标识或明文凭据`)
if (verbose) console.log(`规则 ${rules.length} 条(其中明文凭据 11 条);私有清单 ${existsSync(sensitiveFile) ? sensitiveFile : '未找到'}`)
