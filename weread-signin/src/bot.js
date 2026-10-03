// 第三方底座的调用与解析:带超时看门狗地启动一次阅读会话,并从它的输出里提取本次会话的数字。
import { spawn } from 'node:child_process'
import fs from 'node:fs'

/** 从 cURL 请求体里取本次阅读的书籍 id(解析不到给空串)。 */
export function readBookId(curlFile) {
    try {
        const match = /"b"\s*:\s*"([^"]+)"/.exec(fs.readFileSync(curlFile, 'utf8'))
        return match?.[1] ?? ''
    } catch {
        return ''
    }
}

/** 调底座跑一次阅读会话;返回它的输出摘要。超时则强杀。 */
export function runBot({ python, script, configFile, timeoutMinutes, cwd, curlFile }) {
    return new Promise(resolve => {
        const started = Date.now()
        const child = spawn(python, [script, '--config', configFile], { cwd, windowsHide: true })
        let stdout = ''
        let stderr = ''
        let killed = false
        const timer = setTimeout(() => {
            killed = true
            child.kill('SIGKILL')
        }, timeoutMinutes * 60 * 1000)

        child.stdout.on('data', chunk => { stdout += chunk.toString('utf8') })
        child.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })
        child.on('error', error => {
            clearTimeout(timer)
            resolve({ ok: false, killed: false, seconds: 0, stdout, stderr: String(error.message), exitCode: -1, bookId: '', chapterUid: 0 })
        })
        child.on('close', code => {
            clearTimeout(timer)
            const seconds = Math.round((Date.now() - started) / 1000)
            resolve({ ok: !killed && code === 0, killed, seconds, stdout, stderr, exitCode: code ?? -1, bookId: readBookId(curlFile), chapterUid: 0 })
        })
    })
}

/** 取文本里最后一处匹配(找不到给 null)。regex 必须带 g 标志。 */
function lastMatch(source, regex) {
    let found = null
    for (const match of source.matchAll(regex)) found = match
    return found
}

/** 从底座输出里解析"实际阅读"时长与请求成功次数(它每行都带 emoji,所以只按关键词匹配)。
 *  同一份日志里会叠着好几次会话,所以每个字段都取最后一处匹配 —— 也就是最近一次会话。 */
export function parseBotOutput(text) {
    const source = String(text ?? '')
    const seconds = lastMatch(source, /实际阅读:\s*(\d+)分(\d+)秒/g)
    const requests = lastMatch(source, /成功请求:\s*(\d+)次/g)
    const failures = lastMatch(source, /失败请求:\s*(\d+)次/g)
    const reportedSeconds = seconds ? Number(seconds[1]) * 60 + Number(seconds[2]) : 0
    return {
        reportedSeconds,
        requests: requests ? Number(requests[1]) : 0,
        failures: failures ? Number(failures[1]) : 0
    }
}

/** 底座每次会话都会打印这个横幅;日志里出现多次时,只在最后一次会话的区间里找数字。 */
const SESSION_BANNER = '微信读书阅读机器人'

export function lastSessionSlice(text) {
    const source = String(text ?? '')
    const index = source.lastIndexOf(SESSION_BANNER)
    return index >= 0 ? source.slice(index) : source
}

/** 底座的会话摘要既可能打到 stdout,也可能只写进它自己的日志;两处都试一遍。 */
export function parseBotResult({ stdout, stderr, logFile }) {
    const fromStreams = parseBotOutput(`${stdout}\n${stderr}`)
    if (fromStreams.requests > 0 || fromStreams.reportedSeconds > 0) return fromStreams
    if (logFile && fs.existsSync(logFile)) {
        // 从最后一次会话横幅开始切片,避免把上一次会话的数字混进来
        return parseBotOutput(lastSessionSlice(fs.readFileSync(logFile, 'utf8')))
    }
    return fromStreams
}
