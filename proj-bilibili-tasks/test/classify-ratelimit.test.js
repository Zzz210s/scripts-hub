// 2026-10-25 真实事故的归类回归:投币一条都没投出去,根因是 WAF 临时拦了两个接口
//   `GET /x/web-interface/view` → {"code":-412,"message":"request was banned"}  (HTTP 412)
//   `GET /x/web-interface/ranking/v2` → -352
// 旧实现把它报成「任务接口返回 352 · 异常 · Ray.BiliBiliTool.Domain.Exceptions.BiliBusinessExceptio…」,
// 用户看到的是一串技术噪音,读不出「接口被临时拦了,下次会好」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyRun, sanitizeDetail, detectFeatures } from '../src/classify.js'

// 服务器日志原文(2026-10-25 /srv/apps/automation/bilibili/logs/console/log20261025.txt)
const LINE_412 = '  [10:22:00 WRN] 异常：Refit.ApiException: Response status code does not indicate success: 412 (Precondition Failed).'
const LINE_412_BODY = '  [10:22:00 DBG] 返回Content：{"code":-412,"message":"request was banned","ttl":1}'
const LINE_STACK = '   at Ray.BiliBiliTool.DomainService.VideoDomainService.GetVideoDetail(String aid) in /src/src/Ray.BiliBiliTool.DomainService/VideoDomainService.cs:line 35'
const LINE_352 = '  [10:22:05 WRN] 异常：Ray.BiliBiliTool.Domain.Exceptions.BiliBusinessException: 获取排行榜失败：-352(-352)'

const RATE_NOTE = 'B站 临时风控拦截 · 该接口稍后再试'

test('-412 与 request was banned 归为临时风控拦截', () => {
    const r = classifyRun({ exitCode: 0, stdout: LINE_412 })
    assert.equal(r.rateLimited, true)
    const failure = r.failures.find((f) => f.kind === 'rate-limited')
    assert.ok(failure, JSON.stringify(r.failures))
    assert.equal(failure.note, RATE_NOTE)
    assert.equal(failure.label, '临时风控拦截')
    assert.equal(failure.ignored, true, '风控拦截不单独否定这一轮')
    assert.equal(failure.retryable, true)

    const body = classifyRun({ exitCode: 0, stdout: LINE_412_BODY })
    assert.equal(body.rateLimited, true)
    assert.equal(body.failures[0].note, RATE_NOTE)
})

test('-352 归为临时风控拦截,且与 352 旧口径同源', () => {
    const r = classifyRun({ exitCode: 0, stdout: LINE_352 })
    assert.equal(r.rateLimited, true)
    assert.equal(r.task352, true, '旧字段仍可用,避免下游一次性全改')
    assert.equal(r.failures.find((f) => f.kind === 'rate-limited').note, RATE_NOTE)
})

test('两种风控同时出现时只报一条原因', () => {
    const r = classifyRun({ exitCode: 0, stdout: [LINE_412, LINE_STACK, LINE_352, LINE_352].join('\n') })
    const rateHits = r.failures.filter((f) => f.kind === 'rate-limited')
    assert.equal(rateHits.length, 1, JSON.stringify(r.failures))
    assert.equal(r.failures.length, 1)
})

test('风控拦截的可忽略性:不因它单独把这一轮判成失败', () => {
    const r = classifyRun({ exitCode: 0, stdout: [LINE_412, LINE_352].join('\n') })
    assert.equal(r.ok, true, '投币真没投出时由经验真值的「投币未达标」负责报')
})

test('风控文案里不许出现异常类名与堆栈', () => {
    const r = classifyRun({ exitCode: 0, stdout: [LINE_412, LINE_STACK, LINE_352].join('\n') })
    const text = r.failures.map((f) => `${f.label} ${f.note}`).join(' ')
    assert.doesNotMatch(text, /Exception/)
    assert.doesNotMatch(text, /at Ray\./)
    assert.doesNotMatch(text, /[（）()]/)
})

test('sanitizeDetail 剥掉命名空间、裸类名与堆栈帧,保留错误码与中文结论', () => {
    assert.equal(sanitizeDetail(LINE_352), '异常 · 获取排行榜失败 · -352 -352')
    assert.doesNotMatch(sanitizeDetail(LINE_STACK), /Ray\.|Exception|at /)
    assert.equal(
        sanitizeDetail('  [12:30:26 INF] 领取任务失败：{"Code":6007000,"Message":"请将客户端更新至最新版本"}'),
        '领取任务失败 · 6007000'
    )
    // 正常的业务日志不能被误伤
    assert.equal(sanitizeDetail('  [10:22:05 DBG] 获取排行榜成功'), '获取排行榜成功')
})

test('6007000 仍走「接口要求升级客户端」的老文案', () => {
    const hit = detectFeatures('  [12:30:26 INF] 领取任务失败：{"Code":6007000,"Message":"请将客户端更新至最新版本"}')
    const r = classifyRun({ exitCode: 0, stdout: '  [12:30:26 INF] 领取任务失败：{"Code":6007000,"Message":"请将客户端更新至最新版本"}' })
    assert.equal(r.bigPointFlaky, true)
    const failure = r.failures.find((f) => f.kind === 'bigPointFlaky')
    assert.ok(failure, JSON.stringify(r.failures))
    assert.equal(failure.note, '接口要求升级客户端 · 领取任务失败 · 6007000')
    assert.equal(failure.ignored, true)
    assert.equal(hit.rate412, undefined, '6007000 不能被当成风控')
})
