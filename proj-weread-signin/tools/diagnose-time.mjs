// 排查:官方统计读回的数字与实际"被挑战计入"的时长是否一致。
// 用法:node tools/diagnose-time.mjs
// 只读,不改任何配置;不打印任何凭据。
import fs from 'node:fs'

const KEY_FILE = 'secrets/weread-api-key.txt'
const CURL_FILE = 'secrets/read-request.curl'
const ENDPOINT = 'https://i.weread.qq.com/api/agent/gateway'

const key = fs.readFileSync(KEY_FILE, 'utf8').trim()
const raw = fs.readFileSync(CURL_FILE, 'utf8')
const cookie = /-b '([^']+)'/.exec(raw)?.[1] ?? ''
const ua = /-H 'user-agent: ([^']+)'/.exec(raw)?.[1] ?? ''

function localDay(input) {
    const date = input instanceof Date ? input : new Date(input)
    const pad = v => String(v).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

console.log('=== 1. /readdata/detail 各模式的原样字段 ===')
for (const mode of ['weekly', 'monthly', 'annually']) {
    const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ api_name: '/readdata/detail', skill_version: '1.0.4', mode, baseTime: 0 })
    })
    const payload = await response.json()
    const data = payload.data ?? payload
    const buckets = data.readTimes ?? {}
    const today = localDay()
    const rows = Object.entries(buckets).map(([ts, v]) => ({ day: localDay(Number(ts) * 1000), value: Number(v) }))
    const todayRow = rows.find(row => row.day === today)
    console.log(`mode=${mode} HTTP ${response.status}`)
    console.log(`  totalReadTime=${data.totalReadTime} readDays=${data.readDays} dayAverageReadTime=${data.dayAverageReadTime}`)
    console.log(`  今天(${today})的桶 = ${todayRow ? todayRow.value : '(无)'} ;分桶数 ${rows.length}`)
    console.log(`  最近 4 个桶:${rows.sort((a, b) => a.day.localeCompare(b.day)).slice(-4).map(r => `${r.day}=${r.value}`).join(' ')}`)
}

console.log('\n=== 2. 找"阅读挑战"自己的进度接口 ===')
const webHeaders = {
    accept: 'application/json, text/plain, */*',
    cookie,
    'user-agent': ua,
    referer: 'https://weread.qq.com/web/shelf',
    origin: 'https://weread.qq.com'
}
const candidates = [
    'https://weread.qq.com/web/misc/read-challenge',
    'https://weread.qq.com/web/readdata/challenge',
    'https://weread.qq.com/web/user/challenge',
    'https://weread.qq.com/web/misc/challenge',
    'https://weread.qq.com/web/book/readchallenge',
    'https://weread.qq.com/api/readdata/challenge',
    'https://weread.qq.com/web/readdata/detail?mode=weekly',
    'https://weread.qq.com/web/challenge/info'
]
for (const url of candidates) {
    try {
        const response = await fetch(url, { headers: webHeaders, signal: AbortSignal.timeout(12000) })
        const text = await response.text()
        console.log(`${response.status}  ${url}`)
        console.log(`     ${text.slice(0, 220).replace(/\s+/g, ' ')}`)
    } catch (error) {
        console.log(`ERR  ${url}  ${error.message}`)
    }
}

console.log('\n=== 3. 本地记录:我们实际发了多少秒、官方涨了多少 ===')
const history = JSON.parse(fs.readFileSync('data/history.json', 'utf8'))
let declared = 0
for (const row of history) {
    declared += row.reportedSeconds ?? 0
    console.log(`  ${row.at.slice(11, 16)}Z 上报 ${row.reportedSeconds ?? '-'} 秒 | 读回 ${row.beforeMinutes}->${row.afterMinutes} 分钟 | ${row.requests ?? 0} 请求`)
}
console.log(`  合计上报 ${declared} 秒 = ${(declared / 60).toFixed(1)} 分钟`)
