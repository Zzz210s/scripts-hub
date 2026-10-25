// 今天这条消息的回归夹具:2026-10-25 用户收到的真实消息(原文见报告),用它跑新代码,
// 断言「技术噪音消失、同一件事只说一遍、投币失败的因果说清楚」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyRun } from '../src/classify.js'
import { expFromReward, incompleteTasks } from '../src/exp.js'
import { buildFailures } from '../src/failures.js'
import { buildResultMessage } from '../src/messages.js'

// 服务器日志原文片段(/srv/apps/automation/bilibili/logs/console/log20261025.txt)
const STDOUT = [
    '  [10:21:58 DBG] 返回Content：{"code":0,"message":"OK","ttl":1,"data":{"multiply":0}}',
    '  [10:22:00 WRN] 异常：Refit.ApiException: Response status code does not indicate success: 412 (Precondition Failed).',
    '   at Ray.BiliBiliTool.DomainService.VideoDomainService.GetVideoDetail(String aid) in /src/src/Ray.BiliBiliTool.DomainService/VideoDomainService.cs:line 35',
    '  [10:22:05 WRN] 异常：Ray.BiliBiliTool.Domain.Exceptions.BiliBusinessException: 获取排行榜失败：-352(-352)',
    '  [10:22:05 DBG] 超出单个视频投币数量限制，丢弃处理',
    '  [10:22:32 WRN] 异常：Ray.BiliBiliTool.Domain.Exceptions.BiliBusinessException: 获取排行榜失败：-352(-352)',
    '  [12:30:26 INF] 领取任务失败：{"Code":6007000,"Message":"请将客户端更新至最新版本"}',
    '  [12:06:46 INF] ---开始 漫画签到 ---',
    '  [12:06:51 INF] 【签到结果】成功',
    '  [12:06:51 INF] -------结束-------',
    '  [12:06:51 INF] ---开始 漫画阅读 ---',
    '  [12:06:54 INF] 【漫画阅读】成功',
    '  [12:06:54 INF] -------结束-------'
].join('\n')

const renderToday = () => {
    const classify = classifyRun({ exitCode: 0, stdout: STDOUT })
    // 当晚实测的经验真值:投币 0(整轮没投出)
    const truth = expFromReward({ login: true, watch: true, share: true, coins: 0 })
    const incomplete = incompleteTasks(truth, { coinTarget: 5 })
    const failures = buildFailures({ classify, incomplete, voucherFailure: null })
    return buildResultMessage({
        date: '2026-10-25',
        account: '账号 4048',
        exp: truth,
        donate: { target: 5, actual: 0, balance: 254.6 },
        voucher: { action: 'already' },
        manga: { sign: 'ok', read: 'ok' },
        bigPoint: 'failed',
        failures,
        ok: false
    })
}

test('今天这条消息:原因从三条收敛成两条,且不再出现类名与堆栈', () => {
    const message = renderToday()
    const reasonLines = message.split('\n').filter((line) => line.trim().startsWith('原因:'))
    assert.equal(reasonLines.length, 2, message)
    assert.doesNotMatch(message, /Exception/)
    assert.doesNotMatch(message, /at Ray\./)
    assert.doesNotMatch(message, /Domain\.Service|\.cs:line/)
    assert.doesNotMatch(message, /\[12:30:26 INF\]/)
})

test('今天这条消息:投币那一句说清了风控与重试,而不是「投币未达标」四个字', () => {
    const message = renderToday()
    assert.match(message, /投币 未完成/)
    assert.match(message, /投币被 B站 临时风控拦截 · 下次触发会再试/)
    // 旧的两种说法都不该再出现
    assert.doesNotMatch(message, /任务接口返回 352/)
    assert.doesNotMatch(message, /每日任务未完成 · 投币未达标/)
})

test('今天这条消息:硬规则与体量', () => {
    const message = renderToday()
    assert.doesNotMatch(message, /[（）()]/, '不许圆括号')
    assert.doesNotMatch(message, /\p{Extended_Pictographic}/u, '不许 emoji')
    assert.ok(Buffer.byteLength(message, 'utf8') <= 2048, `字节数 ${Buffer.byteLength(message, 'utf8')}`)
    // 结构仍在:标题四段式 + 每日任务行 + 投币行 + 券行 + 漫画行 + 大积分行
    assert.match(message, /^B站任务 · 账号 4048 · 2026-10-25 · 运行有失败\n\n每日任务:/)
    assert.match(message, /投币:0 枚 · 未投出 · 余额 254\.6/)
    assert.match(message, /漫画:签到成功 · 阅读成功/)
})

test('风控若只影响别的任务,仍如实报未达标而不硬折叠', () => {
    const classify = classifyRun({ exitCode: 0, stdout: STDOUT })
    const truth = expFromReward({ login: true, watch: false, share: true, coins: 50 })
    const incomplete = incompleteTasks(truth, { coinTarget: 5 })
    const failures = buildFailures({ classify, incomplete, voucherFailure: null })
    const kinds = failures.map((f) => f.kind)
    // 同一个 STDOUT 里也有 6007000(大积分),它照旧单独报一条,与风控无关
    assert.deepEqual(kinds, ['rate-limited', 'bigPointFlaky', 'incomplete'])
    assert.equal(failures[2].note, '每日任务未完成 · 观看未达标')
})
