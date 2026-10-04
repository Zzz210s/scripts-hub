// 探针:验证腾讯官方只读接口能否读到阅读统计(用于"时长是否真被计入"的读回校验)。
// 用法:node tools/probe-stats.mjs [weekly|monthly|annually|overall]
// Key 从 secrets/weread-api-key.txt 读取,不出现在命令行里,也不打印。
import fs from 'node:fs'
import path from 'node:path'

const ENDPOINT = 'https://i.weread.qq.com/api/agent/gateway'
const KEY_FILE = path.join(import.meta.dirname, '..', 'secrets', 'weread-api-key.txt')
const SKILL_VERSION = '1.0.4'
const mode = process.argv[2] ?? 'weekly'

function readKey() {
    if (!fs.existsSync(KEY_FILE)) throw new Error(`找不到 API Key 文件:${KEY_FILE}`)
    const key = fs.readFileSync(KEY_FILE, 'utf8').trim()
    if (!key.startsWith('wrk-')) throw new Error('API Key 格式不对(应以 wrk- 开头)')
    return key
}

function fmt(seconds) {
    const minutes = Math.round(seconds / 60)
    return `${minutes} 分钟(${seconds} 秒)`
}

const key = readKey()
const started = Date.now()
const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ api_name: '/readdata/detail', skill_version: SKILL_VERSION, mode, baseTime: 0 }),
    signal: AbortSignal.timeout(20000)
})

console.log(`HTTP ${response.status} | ${Date.now() - started}ms | mode=${mode}`)
const text = await response.text()
let data
try {
    data = JSON.parse(text)
} catch {
    console.log('响应不是 JSON:', text.slice(0, 300))
    process.exit(1)
}

if (response.status !== 200) {
    console.log('响应体:', JSON.stringify(data).slice(0, 400))
    process.exit(1)
}

const payload = data.data ?? data
const keys = Object.keys(payload)
console.log(`顶层字段(${keys.length}):`, keys.slice(0, 18).join(', '))

if (typeof payload.totalReadTime === 'number') {
    console.log(`本周期总时长 totalReadTime = ${fmt(payload.totalReadTime)}`)
}
if (typeof payload.readDays === 'number') {
    console.log(`有效阅读天数 readDays = ${payload.readDays}(官方口径:单日满 1 分钟)`)
}
if (typeof payload.dayAverageReadTime === 'number') {
    console.log(`自然日均 dayAverageReadTime = ${fmt(payload.dayAverageReadTime)}`)
}

// readTimes 是按时间分桶的明细(秒),今天那一桶就是我们关心的"今日分钟"
const buckets = payload.readTimes ?? payload.dailyReadTimes
if (buckets && typeof buckets === 'object') {
    const pad = n => String(n).padStart(2, '0')
    const dayKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    const today = dayKey(new Date())
    const rows = Object.entries(buckets)
        .map(([ts, seconds]) => ({ day: dayKey(new Date(Number(ts) * 1000)), seconds: Number(seconds) }))
        .sort((a, b) => a.day.localeCompare(b.day))
    console.log(`分桶明细 ${rows.length} 条,最近 5 条:`)
    for (const row of rows.slice(-5)) {
        console.log(`  ${row.day}: ${fmt(row.seconds)}${row.day === today ? '   <- 今天' : ''}`)
    }
    const todayRow = rows.find(row => row.day === today)
    console.log(todayRow ? `今日时长 = ${fmt(todayRow.seconds)}` : '今天的桶还没有(说明今天还没有被计入的阅读)')
} else {
    console.log('没有 readTimes/dailyReadTimes 字段,原始响应片段:')
    console.log(JSON.stringify(payload).slice(0, 500))
}
