import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { lastSessionSlice, parseBotResult, readBookId } from '../src/bot.js'

// 与分析用的样本同形:请求体里带 "b"(书籍 id)与 "rt"(阅读时长)
const CURL = `curl --url 'https://weread.qq.com/web/book/read' \\
  -H 'content-type: application/json;charset=UTF-8' \\
  -b 'wr_vid=547414326; wr_skey=oldkey' \\
  --data-raw '{"b":"ce032b305a9bc1ce0b0dd2a","rt":30}'`

/** content 为 null 时不落盘,用来模拟文件缺失。 */
function tmpCurl(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-bot-'))
    const file = path.join(dir, 'read-request.curl')
    if (content !== null) fs.writeFileSync(file, content, 'utf8')
    return file
}

test('readBookId:从 cURL 请求体里取出书籍 id', () => {
    assert.equal(readBookId(tmpCurl(CURL)), 'ce032b305a9bc1ce0b0dd2a')
})

test('readBookId:文件不存在时给空串,不抛错', () => {
    assert.equal(readBookId(tmpCurl(null)), '')
})

test('readBookId:请求体里没有 "b" 字段时给空串', () => {
    assert.equal(readBookId(tmpCurl(`curl --url 'https://weread.qq.com/web/book/read' --data-raw '{"rt":30}'`)), '')
})

test('parseBotResult:日志里叠了两段会话时取后一段(本次)的数字', () => {
    // 真实故障现场:上一段会话的数字在前、本次的在后,回退解析曾取到前一段
    const sample = fs.readFileSync('test/fixtures/bot-log-sample.txt', 'utf8')
    const older = sample
        .replace('实际阅读: 3分48秒', '实际阅读: 69分6秒')
        .replace('成功请求: 3次', '成功请求: 85次')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-log-'))
    const file = path.join(dir, 'weread.log')
    fs.writeFileSync(file, `${older}\n${sample}`, 'utf8')

    const parsed = parseBotResult({ stdout: '', stderr: '', logFile: file })
    assert.equal(parsed.reportedSeconds, 228)   // 3分48秒,不是 69分6秒
    assert.equal(parsed.requests, 3)            // 3 次,不是 85 次
    assert.equal(parsed.failures, 0)
})

test('lastSessionSlice:从最后一次会话横幅开始切,没有横幅时原样返回', () => {
    const text = '📚 微信读书阅读机器人\n旧一段\n🚀 微信读书阅读机器人启动\n新一段'
    assert.equal(lastSessionSlice(text), '微信读书阅读机器人启动\n新一段')
    assert.equal(lastSessionSlice('没有横幅'), '没有横幅')
})
