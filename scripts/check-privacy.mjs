#!/usr/bin/env node
//
// check-privacy:扫本仓库**已跟踪文件**里的个人标识与凭据形状,命中即退出 1。
// 与 sync-microsoft-rewards.sh 的发布前脱敏是两道独立防线:那道管快照内容,这道管整个仓库。
//
// 用法:node scripts/check-privacy.mjs [--verbose]
//   --verbose  连通过项也打印
//
// 机器私有标识(真实姓名/邮箱/主机名/用户名)从 ~/.config/automation-suite/sensitive-patterns.txt
// 读取(一行一个,仓库外,永不入库);读不到就只跑通用规则。可用 SENSITIVE_PATTERNS_FILE 覆盖位置。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const repo = path.resolve(import.meta.dirname, '..')
// 本文件自身含允许清单里的公开提交身份字面量,只对它跳过「私有标识」规则(通用规则照跑)
const SELF = 'scripts/check-privacy.mjs'
const verbose = process.argv.includes('--verbose')
const BS = String.fromCharCode(92)

// 公开且允许出现的提交身份与示例值
const ALLOWED_EMAILS = [/^zzz210s@qq\.com$/]
const ALLOWED_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'x.com']
const ALLOWED_EMAIL_LOCALS = ['sample', 'user', 'email', 'alpha', 'beta', 'test', 'you']

const RULES = [
  ['本机用户目录路径', new RegExp(`[A-Za-z]:[${BS}${BS}${BS}/]{1,2}Users`, 'i'), null],
  ['盘符绝对路径', new RegExp(`(^|[^A-Za-z0-9])(C|D|E|F|G):[${BS}${BS}${BS}]{1,2}[A-Za-z0-9_]`), null],
  ['Unix 家目录路径', /\/home\/[a-z][a-z0-9_-]{2,}/, null],
  ['微软凭据形状', /wrk-(?!EXAMPLE|xxxxxxxx|x{4,})[A-Za-z0-9_-]{10,}/, null],
  ['企业微信 webhook 真 key', /webhook\/send\?key=(?!0{8}|YOUR_WEBHOOK_KEY)[A-Za-z0-9-]{20,}/, null],
  ['中国大陆手机号', /(^|[^\d-])1[3-9]\d{9}([^\d-]|$)/, null],
  ['微信 wxid', /wxid_[A-Za-z0-9]{6,}/, null],
  ['邮箱', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, allowedEmail],
  ['私有标识', null, null], // 由 sensitive-patterns.txt 填充
]

function allowedEmail(value) {
  if (ALLOWED_EMAILS.some(re => re.test(value))) return true
  const [local, domain] = value.split('@')
  return ALLOWED_EMAIL_DOMAINS.includes(domain) || ALLOWED_EMAIL_LOCALS.includes(local)
}

const sensitiveFile = process.env.SENSITIVE_PATTERNS_FILE ?? path.join(homedir(), '.config', 'automation-suite', 'sensitive-patterns.txt')
const privatePatterns = []
if (existsSync(sensitiveFile)) {
  for (const raw of readFileSync(sensitiveFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    privatePatterns.push(line)
    RULES.push([`私有标识 ${line}`, null, null, line])
  }
}
// 私有清单里的每个标识单独成一条规则(上面已 push),去掉占位那条
RULES.splice(RULES.findIndex(r => r[0] === '私有标识'), 1)

function isText(buf) {
  const sample = buf.subarray(0, 4096)
  return !sample.includes(0)
}

const files = execFileSync('git', ['ls-files', '-z'], { cwd: repo, maxBuffer: 1 << 26 })
  .toString()
  .split('\0')
  .filter(Boolean)

let findings = 0
const fileNameHits = []
for (const rel of files) {
  for (const [name, , , literal] of RULES) {
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
  for (const [name, re, allow, literal] of RULES) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (literal) {
        if (rel === SELF) continue
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

if (findings) {
  console.log(`\n结论:发现 ${findings} 处待复核(上方逐条列出)。本机私有清单:${existsSync(sensitiveFile) ? sensitiveFile : '未找到(只跑了通用规则)'}`)
  process.exit(1)
}
console.log(`通过:${files.length} 个已跟踪文件未发现个人标识或凭据形状`)
if (verbose) console.log(`规则 ${RULES.length} 条;私有清单 ${existsSync(sensitiveFile) ? sensitiveFile : '未找到'}`)
