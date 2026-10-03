// 官方阅读统计读回(腾讯只读接口)。用于校验"本次上报的时长是否真的被计入"。
//
//   POST https://i.weread.qq.com/api/agent/gateway
//   Header: Authorization: Bearer wrk-xxxx
//   Body:   { api_name: "/readdata/detail", skill_version, mode, baseTime }
//
// 单位约定(官方文档明确要求,不得按字段名猜):totalReadTime / readTimes 均为**秒**。
// 注意 readDays 是官方口径的"有效阅读天数"(单日满 1 分钟),与阅读挑战要求的"单日满 5 分钟"不同,
// 所以校验当天是否达标要看今日秒数,而不是 readDays。
import fs from 'node:fs'
import path from 'node:path'

export const ENDPOINT = 'https://i.weread.qq.com/api/agent/gateway'
export const SKILL_VERSION = '1.0.4'

function localDay(input) {
    const date = input instanceof Date ? input : new Date(input)
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function num(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
}

/** 把接口回包归一成我们自己的形状(纯函数,便于离线测试)。 */
export function parseStats(payload = {}, { now = new Date() } = {}) {
    const data = payload.data ?? payload
    const raw = data.readTimes ?? data.dailyReadTimes ?? {}
    const buckets = Object.entries(raw)
        .map(([ts, seconds]) => ({ day: localDay(num(ts) * 1000), seconds: num(seconds) }))
        .sort((a, b) => a.day.localeCompare(b.day))
    const today = buckets.find(bucket => bucket.day === localDay(now))
    return {
        totalSeconds: num(data.totalReadTime),
        readDays: num(data.readDays),
        dayAverageSeconds: num(data.dayAverageReadTime),
        compare: typeof data.compare === 'number' ? data.compare : null,
        buckets,
        todaySeconds: today ? today.seconds : 0
    }
}

/** 今天已计入的秒数(今天还没有分桶时返回 0)。 */
export function todaySeconds(payload, now = new Date()) {
    return parseStats(payload, { now }).todaySeconds
}

export function minutes(seconds) {
    return Math.round(seconds / 60)
}

export function summarize({ totalSeconds, readDays, todaySeconds: today }) {
    return `今日 ${minutes(today)} 分钟 | 本周期 ${minutes(totalSeconds)} 分钟 | 有效天数 ${readDays} 天`
}

export function loadApiKey(file) {
    if (!fs.existsSync(file)) throw new Error(`找不到 API Key 文件:${file}`)
    const key = fs.readFileSync(file, 'utf8').trim()
    if (!key.startsWith('wrk-')) throw new Error('API Key 格式不对 · 应以 wrk- 开头')
    return key
}

/** 调官方接口读回统计;失败时抛出带原因的 Error,调用方决定是告警还是重试。 */
export async function readStats(options) {
    const { apiKey, mode = 'weekly', baseTime = 0, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = options ?? {}
    if (!apiKey) throw new Error('缺少 apiKey')
    const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ api_name: '/readdata/detail', skill_version: SKILL_VERSION, mode, baseTime }),
        signal: AbortSignal.timeout(timeoutMs)
    })
    const text = await response.text()
    if (response.status !== 200) throw new Error(`统计接口 HTTP ${response.status}:${text.slice(0, 200)}`)
    let payload
    try {
        payload = JSON.parse(text)
    } catch {
        throw new Error(`统计接口返回的不是 JSON:${text.slice(0, 200)}`)
    }
    return parseStats(payload)
}

/** 读回统计带重试:这台机器的网络偶发超时,一次失败不该让整次运行算作没跑。 */
export async function readStatsWithRetry(cwd, config, attempts = 3) {
    const apiKey = loadApiKey(path.join(cwd, config.apiKeyFile))
    let lastError = ''
    for (const [index, wait] of [0, 2000, 8000].slice(0, attempts).entries()) {
        if (wait) await new Promise(resolve => setTimeout(resolve, wait))
        try {
            const stats = await readStats({ apiKey, mode: 'monthly' })
            return { ok: true, stats }
        } catch (error) {
            lastError = `${error.message} · 第 ${index + 1} 次`
        }
    }
    return { ok: false, error: lastError }
}

// CLI:node src/stats.js [weekly|monthly|annually|overall]
if (process.argv[1]?.endsWith('stats.js')) {
    const keyFile = new URL('../secrets/weread-api-key.txt', import.meta.url)
    const mode = process.argv[2] ?? 'weekly'
    const apiKey = loadApiKey(keyFile)
    const stats = await readStats({ apiKey, mode })
    console.log(summarize(stats))
    console.log(`最近 3 天:${stats.buckets.slice(-3).map(b => `${b.day} ${minutes(b.seconds)} 分钟`).join(' | ')}`)
}
