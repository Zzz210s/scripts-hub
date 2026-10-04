// App 通道上报:POST https://i.weread.qq.com/book/read
//
// 与网页心跳(/web/book/read)的区别:这个接口带 readingTime / autoTime / chapterProgress /
// progress / wordCount / risk 等字段,是 App 自己的上报口径(挑战进度就在 App 里),
// 因此更可能被挑战完整计入。字段清单来自 teng-lin/weread-omni(MIT)的 docs/endpoints.md。
//
// 实测(2026-10-01):不带 signature 或几种 sha256/md5 变体都被接受,回 {"succ":1};
// 这里统一带上 sha256(timestamp+deviceId+random),与官方登录签名同构。
import { createHash } from 'node:crypto'
import fs from 'node:fs'

import { APP_BASE, appHeaders, credentialsPath } from './app-auth.js'

export function buildReadPayload(input) {
    const timestamp = input.timestamp ?? Date.now()
    const random = input.random ?? Math.floor(Math.random() * 1000)
    const payload = {
        timestamp,
        random,
        appId: input.appId ?? '',
        bookId: input.bookId,
        chapterUid: input.chapterUid,
        chapterIdx: input.chapterIdx ?? 0,
        chapterOffset: input.chapterOffset ?? 0,
        chapterProgress: input.progress ?? 0,
        currentProgress: input.progress ?? 0,
        progress: input.progress ?? 0,
        deviceId: input.deviceId,
        installId: input.installId ?? '',
        finish: 0,
        isLecture: 0,
        isStoryFeed: 0,
        curType: 0,
        lectureTextTime: 0,
        lectureTime: 0,
        novalTime: 0,
        ttsTime: 0,
        voiceType: 0,
        recordCreateTimeZone: input.timezone ?? 8,
        reviewId: 0,
        risk: 0,
        summary: String(input.summary ?? '').slice(0, 60),
        wordCount: input.wordCount ?? 300,
        readingTime: Math.max(1, Math.round(input.seconds ?? 60)),
        autoTime: input.autoTime ?? 0,
        isResendReadingInfo: 0
    }
    payload.signature = createHash('sha256').update(`${timestamp}${payload.deviceId}${random}`).digest('hex')
    return payload
}

export async function reportOnce(input) {
    const payload = buildReadPayload(input)
    try {
        const response = await fetch(`${APP_BASE}/book/read`, {
            method: 'POST',
            headers: appHeaders(input.token),
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(20000)
        })
        const text = await response.text()
        let body = {}
        try {
            body = JSON.parse(text)
        } catch { /* 非 JSON 保留原文 */ }
        const ok = response.status === 200 && (body.succ === 1 || body.succ === true)
        return { ok, status: response.status, body, text: text.slice(0, 160) }
    } catch (error) {
        return { ok: false, status: 0, error: error.message }
    }
}

export function loadAppContext(cwd) {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath(cwd), 'utf8'))
    const curl = fs.readFileSync(`${cwd}/secrets/read-request.curl`, 'utf8')
    const template = JSON.parse(/--data-raw '([\s\S]+)'\s*$/.exec(curl.trim())[1])
    return { credentials, template }
}

/** 发一段阅读:按 intervalSeconds 间隔发 count 次,每次声明 secondsPerReport 秒。 */
export async function runAppSession(options) {
    const { token, template, credentials, count, secondsPerReport, intervalSeconds, onProgress } = options
    const results = []
    let reported = 0
    for (let index = 0; index < count; index += 1) {
        const result = await reportOnce({
            token,
            deviceId: credentials.deviceId,
            installId: credentials.installId,
            appId: template.appId,
            bookId: template.b,
            chapterUid: template.c,
            chapterIdx: Number(template.ci) || 4,
            chapterOffset: Number(template.co) || 0,
            progress: 0.1 + index * 0.01,
            summary: template.sm,
            seconds: secondsPerReport
        })
        results.push(result)
        if (result.ok) reported += secondsPerReport
        await onProgress?.({ index: index + 1, count, ok: result.ok, reported, detail: result.text ?? result.error })
        if (index < count - 1) await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000))
    }
    return { reported, requests: results.length, failures: results.filter(item => !item.ok).length, results }
}

// CLI:node src/app-report.js <次数> [每次秒数] [间隔秒]
if (process.argv[1]?.endsWith('app-report.js')) {
    const cwd = process.cwd()
    const { credentials, template } = loadAppContext(cwd)
    const count = Number(process.argv[2] ?? 3)
    const perReport = Number(process.argv[3] ?? 60)
    const interval = Number(process.argv[4] ?? 5)
    console.log(`开始 App 通道上报:${count} 次 × ${perReport} 秒,间隔 ${interval} 秒`)
    const result = await runAppSession({
        token: credentials, template, credentials, count, secondsPerReport: perReport, intervalSeconds: interval,
        onProgress: step => console.log(`  #${step.index}/${step.count} ${step.ok ? 'ok' : '失败'} 累计 ${step.reported} 秒 ${step.ok ? '' : step.detail}`)
    })
    console.log(`完成:声明 ${result.reported} 秒,失败 ${result.failures} 次`)
}
