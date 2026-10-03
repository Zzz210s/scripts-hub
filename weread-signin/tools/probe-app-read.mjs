// 探针:试探 App 侧阅读上报接口 POST /book/read 的载荷与签名要求。
// 只发很小的 readingTime(60 秒),用于确认协议能否被接受;响应原样打印(不含凭据)。
import { createHash } from 'node:crypto'
import fs from 'node:fs'

import { APP_BASE, appHeaders, deviceHeaders } from '../src/app-auth.js'

const cwd = process.cwd()
const credentials = JSON.parse(fs.readFileSync(`${cwd}/secrets/app-credentials.json`, 'utf8'))
const curl = fs.readFileSync(`${cwd}/secrets/read-request.curl`, 'utf8')
const template = JSON.parse(/--data-raw '([\s\S]+)'\s*$/.exec(curl.trim())[1])

const bookId = template.b
const chapterUid = template.c
const appId = template.appId

function basePayload() {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 1000)
    return {
        timestamp,
        random,
        appId,
        bookId,
        chapterUid,
        chapterIdx: Number(template.ci) || 4,
        chapterOffset: Number(template.co) || 0,
        chapterProgress: 0.12,
        currentProgress: 0.12,
        progress: 0.12,
        deviceId: credentials.deviceId,
        installId: credentials.installId ?? 'eink310000000000000000000000000',
        finish: 0,
        isLecture: 0,
        isStoryFeed: 0,
        curType: 0,
        lectureTextTime: 0,
        lectureTime: 0,
        novalTime: 0,
        ttsTime: 0,
        voiceType: 0,
        recordCreateTimeZone: 8,
        reviewId: 0,
        risk: 0,
        summary: String(template.sm ?? '').slice(0, 60),
        wordCount: 300,
        readingTime: 60,
        autoTime: 0,
        isResendReadingInfo: 0
    }
}

const variants = [
    ['不带 signature', payload => payload],
    ['sha256(ts+deviceId+random)', payload => ({ ...payload, signature: createHash('sha256').update(`${payload.timestamp}${payload.deviceId}${payload.random}`).digest('hex') })],
    ['sha256(readingTime+ts+deviceId+random)', payload => ({ ...payload, signature: createHash('sha256').update(`${payload.readingTime}${payload.timestamp}${payload.deviceId}${payload.random}`).digest('hex') })],
    ['md5(ts+deviceId+random)', payload => ({ ...payload, signature: createHash('md5').update(`${payload.timestamp}${payload.deviceId}${payload.random}`).digest('hex') })]
]

for (const [label, decorate] of variants) {
    const payload = decorate(basePayload())
    try {
        const response = await fetch(`${APP_BASE}/book/read`, {
            method: 'POST',
            headers: appHeaders(credentials),
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(20000)
        })
        const text = await response.text()
        console.log(`${label}: HTTP ${response.status} ${text.slice(0, 220).replace(/\s+/g, ' ')}`)
    } catch (error) {
        console.log(`${label}: 请求失败 ${error.message}`)
    }
    await new Promise(resolve => setTimeout(resolve, 1500))
}

console.log(`\n设备头示例:${Object.keys(deviceHeaders()).join(', ')}`)
