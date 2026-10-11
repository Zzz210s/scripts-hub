#!/usr/bin/env node
// 通知通道保真检测:把中文样例送进每一个会发企微消息的通道,拿本地假端点收下来,
// 断言收到的正文与原文逐字节一致(不是"看起来正常")。
//
// 用法:node scripts/check-notify-fidelity.mjs
//       node scripts/check-notify-fidelity.mjs --verbose
//
// 为什么要有它:2026-10-11 出过一次通知乱码事故 —— note-sync 的 json_escape 用
// `json.dumps(sys.stdin.read())`,而 Windows 上 python 的 stdin 是 cp936,UTF-8 中文被读坏后
// 又被转义固化进消息。当时没人能一眼看出是哪一层坏的,只能靠往真实群里发消息试。
// 这个脚本把"试"变成"断言",并且不碰真实通道。
//
// 覆盖:本机 notify-wecom.sh、两个 Linux 侧 notify()、alert-fail.mjs、四个 proj 发送器。
// pi-wecom-bot 不在范围内 —— 它的回复由自己的 test/e2e.test.ts 用假 ws 服务器端到端验证。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERBOSE = process.argv.includes('--verbose')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-fidelity-'))

const SAMPLE = [
    '中文保真样例:全角标点 · —— 「引号」《书名》 100% $ 反引号` 反斜杠\\ 双引号"',
    '路径:F:\\0-Note\\记录\\记录-博客站重构-2026-10.md',
    '生僻字与扩展区:𠮷 龘 ㈱ ①②',
    '第二行:制表\t符,末尾无空格'
].join('\n')

const NODE_SENDERS = [
    'proj-bilibili-tasks/src/notify.js',
    'proj-epic-free-games/src/notify.js',
    'proj-weread-signin/src/notify.js',
    'proj-microsoft-rewards/wechat-bridge/lib/wecom.js'
]

const results = []
const record = (channel, ok, detail) => {
    results.push({ channel, ok, detail })
    process.stdout.write(`[${ok ? 'OK  ' : 'FAIL'}] ${channel}${detail ? ' —— ' + detail : ''}\n`)
}

/** 本地假企微端点:收下每个请求的原始字节。 */
function startEndpoint() {
    const seen = []
    const server = http.createServer((req, res) => {
        const chunks = []
        req.on('data', c => chunks.push(c))
        req.on('end', () => {
            seen.push(Buffer.concat(chunks))
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }))
        })
    })
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/` }))
    })
}

function writeTmp(name, text) {
    const file = path.join(TMP, name)
    fs.writeFileSync(file, text, 'utf8')
    return file
}

function runShell(cmd, args, env = {}) {
    return new Promise(resolve => {
        const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        child.stdout.on('data', d => { out += d })
        child.stderr.on('data', d => { out += d })
        child.on('close', code => resolve({ code, out }))
    })
}

/** 断言收到的载荷里 text.content 与原文一致(exact)或包含原文(contains,用于自组正文的发送器)。 */
function checkPayload(bodies, expected, channel, mode = 'exact') {
    if (bodies.length === 0) return record(channel, false, '端点没收到任何请求')
    let content = null
    try {
        const body = JSON.parse(bodies[bodies.length - 1].toString('utf8'))
        content = body?.text?.content ?? body?.markdown?.content ?? null
    } catch (error) {
        return record(channel, false, `载荷不是合法 JSON:${error.message}`)
    }
    if (content === null) return record(channel, false, '载荷里没有 text.content')
    if (mode === 'contains') {
        if (!content.includes(expected)) return record(channel, false, '正文里找不到样例原文(可能被改写或截断)')
        if (content.includes('\uFFFD')) return record(channel, false, '正文含替换字符,说明某一层解码失败')
        return record(channel, true, `正文包含样例原文,共 ${Buffer.byteLength(content, 'utf8')} 字节`)
    }
    if (content !== expected) {
        const at = [...content].findIndex((ch, i) => ch !== [...expected][i])
        return record(channel, false, `正文与原文不一致(首个差异在第 ${at} 个字符)`)
    }
    record(channel, true, `${Buffer.byteLength(content, 'utf8')} 字节逐字节一致`)
}

/** 从 bash 脚本里抠出 notify() 函数体(这些脚本独立部署,不能整体 source)。 */
function extractNotify(scriptPath) {
    const text = fs.readFileSync(path.join(ROOT, scriptPath), 'utf8').replace(/\r\n/g, '\n')
    const start = text.indexOf('notify() {')
    if (start === -1) throw new Error(`${scriptPath} 里找不到 notify()`)
    let depth = 0
    for (let i = text.indexOf('{', start); i < text.length; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') {
            depth--
            if (depth === 0) return text.slice(start, i + 1)
        }
    }
    throw new Error(`${scriptPath} 的 notify() 没有闭合`)
}

const { server, seen, url } = await startEndpoint()
try {
    const urlFile = writeTmp('webhook.txt', url + '\n')
    const sampleFile = writeTmp('sample.txt', SAMPLE)

    // 1) 本机 helper(Windows note-sync 实际走的就是它)
    let before = seen.length
    await runShell('bash', ['scripts/note-sync/notify-wecom.sh', SAMPLE], { WECOM_WEBHOOK_FILE: urlFile })
    checkPayload(seen.slice(before), SAMPLE, 'scripts/note-sync/notify-wecom.sh')
    // 2) 两个 Linux 侧 notify():抠出函数 + 打桩 log(),用同一个样例跑一遍
    for (const script of ['scripts/linux/note-sync/note-sync.sh', 'scripts/linux/mem-guard/mem-guard.sh']) {
        const wrapper = writeTmp(`wrap-${path.basename(script)}`, [
            '#!/usr/bin/env bash',
            'set -uo pipefail',
            `WEBHOOK_FILE=${JSON.stringify(urlFile)}`,
            'LOG=/dev/null',
            'log() { :; }',
            extractNotify(script),
            `notify "$(cat ${JSON.stringify(sampleFile)})"`
        ].join('\n'))
        before = seen.length
        const res = await runShell('bash', [wrapper])
        if (res.code !== 0) record(script, false, `notify() 退出码 ${res.code}:${res.out.trim().slice(0, 120)}`)
        else checkPayload(seen.slice(before), SAMPLE, script)
    }

    // 3) alert-fail.mjs(靠 NOTIFY_WEBHOOK_URL 覆盖,默认值是服务器上的真实路径)
    before = seen.length
    try {
        const alert = await runShell('node', ['scripts/linux/alert-fail.mjs', '服务器', SAMPLE], { NOTIFY_WEBHOOK_URL: url })
        if (alert.code !== 0) record('scripts/linux/alert-fail.mjs', false, `退出码 ${alert.code}:${alert.out.trim().slice(0, 120)}`)
        else checkPayload(seen.slice(before), SAMPLE, 'scripts/linux/alert-fail.mjs', 'contains')
    } catch (error) {
        record('scripts/linux/alert-fail.mjs', false, `调用抛错:${error.message}`)
    }

    // 4) 四个 proj 发送器:直接调 sendWecom,走真实 fetch 打本地端点。
    //    各实现的选项名不完全一致(microsoft-rewards 只让覆盖 url),所以按导出形状调用。
    for (const rel of NODE_SENDERS) {
        before = seen.length
        try {
            const mod = await import(pathToFileURL(path.join(ROOT, rel)).href)
            const options = rel.includes('microsoft-rewards') ? { url } : { webhook: url, retries: 0 }
            const res = await mod.sendWecom(SAMPLE, options)
            if (res && res.ok === false) record(rel, false, `sendWecom 返回 ${res.error}`)
            else checkPayload(seen.slice(before), SAMPLE, rel)
        } catch (error) {
            record(rel, false, `调用抛错:${error.message}`)
        }
    }

    // 5) 超长正文必须被截断且截断后仍是合法 UTF-8(不出现替换字符)
    before = seen.length
    const long = '长'.repeat(2000)
    await runShell('bash', ['scripts/note-sync/notify-wecom.sh', long], { WECOM_WEBHOOK_FILE: urlFile })
    const bodies = seen.slice(before)
    if (bodies.length === 0) record('超长正文截断', false, '端点没收到请求')
    else {
        const content = JSON.parse(bodies[bodies.length - 1].toString('utf8')).text.content
        const bytes = Buffer.byteLength(content, 'utf8')
        const bad = content.includes('\uFFFD')
        if (bytes > 2048 || bad) record('超长正文截断', false, `${bytes} 字节 / 含替换字符=${bad}`)
        else record('超长正文截断', true, `${bytes} 字节,尾部 ${content.slice(-8)}`)
    }

    // 6) 静态护栏:发送路径里不许再出现把 stdin 当 UTF-8 读的写法
    const hazard = []
    for (const rel of ['scripts/note-sync/notify-wecom.sh', 'scripts/linux/note-sync/note-sync.sh', 'scripts/linux/mem-guard/mem-guard.sh']) {
        const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
        if (/sys\.stdin\.read\(\)/.test(text) || /json\.load\(sys\.stdin\)/.test(text)) hazard.push(rel)
    }
    record('静态护栏(python 读 stdin)', hazard.length === 0, hazard.join(', ') || '无危险写法')
} finally {
    server.close()
    fs.rmSync(TMP, { recursive: true, force: true })
}

const failed = results.filter(r => !r.ok)
process.stdout.write(`\n汇总:${results.length - failed.length}/${results.length} 通过\n`)
if (VERBOSE && failed.length) for (const f of failed) process.stdout.write(`  - ${f.channel}: ${f.detail}\n`)
process.exit(failed.length === 0 ? 0 : 1)
