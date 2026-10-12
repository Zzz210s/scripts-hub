import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyRun, detectFeatures, computeExp, sanitizeDetail, readMangaFacts } from '../src/classify.js'

test('-403 需要同行关键词;裸 -403 不命中', () => {
    assert.equal(classifyRun({ exitCode: 0, stdout: '投币失败 -403 账号异常' }).risk403, true)
    assert.equal(classifyRun({ exitCode: 0, stdout: '余额 128.0 aid=403123' }).risk403, false)
    assert.equal(classifyRun({ exitCode: 0, stdout: '-403' }).risk403, false)
})

test('352 需要同行关键词;裸数字不命中', () => {
    assert.equal(classifyRun({ exitCode: 0, stdout: '观看失败 352' }).task352, true)
    assert.equal(classifyRun({ exitCode: 0, stdout: '耗时 1352 ms' }).task352, false)
    assert.equal(classifyRun({ exitCode: 0, stdout: '352' }).task352, false)
})

test('6007000 -> bigPointFlaky 且不计入成败', () => {
    const r = classifyRun({ exitCode: 0, stdout: '大积分 receive/v2 返回 6007000 请将客户端更新至最新版本' })
    assert.equal(r.bigPointFlaky, true)
    assert.equal(r.ok, true)
    assert.equal(r.failures.filter((f) => !f.ignored).length, 0)
})

test('69801 -> voucherTaken 不算失败', () => {
    const r = classifyRun({ exitCode: 0, stdout: '69801 你已领取过该权益' })
    assert.equal(r.voucherTaken, true)
    assert.equal(r.ok, true)
    assert.equal(r.failures.length, 0)
})

test('cookieInvalid 中英文特征', () => {
    assert.equal(classifyRun({ exitCode: 0, stdout: '账号未登录' }).cookieInvalid, true)
    assert.equal(classifyRun({ exitCode: 0, stdout: 'please login required' }).cookieInvalid, true)
})

test('分享失败与观看失败', () => {
    assert.equal(classifyRun({ exitCode: 0, stdout: '分享被风控拒绝' }).shareFailed, true)
    assert.equal(classifyRun({ exitCode: 0, stdout: '观看视频失败' }).watchFailed, true)
})

// R2:真实日志行(2026-10-11 实测)——Console 的 CookieTaskGuard 超时后静默跳过整次任务,退出码仍是 0
test('登录态检查被跳过 -> guard-skipped,退出码 0 也不算成功', () => {
    const line = '[12:55:15 WRN] 异常:System.InvalidOperationException: 登录态检查暂时失败,本次活动已跳过,稍后自动重试'
    const r = classifyRun({ exitCode: 0, stdout: line })
    assert.equal(r.guardSkipped, true)
    assert.equal(r.ok, false)
    const failure = r.failures.find((f) => f.kind === 'guard-skipped')
    assert.ok(failure, JSON.stringify(r.failures))
    assert.equal(failure.ignored, false)
    assert.ok(failure.note.includes('未做任何任务'), failure.note)
})

test('备选特征「本次活动已跳过」也能命中 guard-skipped', () => {
    assert.equal(classifyRun({ exitCode: 0, stdout: '本次活动已跳过,稍后自动重试' }).guardSkipped, true)
})

test('guard-skipped 时估算口径也报未完成,不冒充已得', () => {
    const view = computeExp({ classify: { guardSkipped: true }, target: 5 })
    assert.equal(view.login, '未完成')
    assert.equal(view.watch, '未完成')
    assert.equal(view.share, '未完成')
    assert.equal(view.total, 0)
})

test('超时按可重试失败处理', () => {
    const r = classifyRun({ exitCode: null, timedOut: true })
    assert.equal(r.timedOut, true)
    assert.equal(r.ok, false)
    assert.ok(r.failures.some((f) => f.kind === 'timeout'))
})

test('退出码 0 -> ok;退出码 1 无特征 -> 失败', () => {
    assert.equal(classifyRun({ exitCode: 0, stdout: '一切正常' }).ok, true)
    const r = classifyRun({ exitCode: 1, stdout: '一切正常' })
    assert.equal(r.ok, false)
    assert.ok(r.failures.length >= 1)
})

test('detectFeatures 逐行匹配', () => {
    const hit = detectFeatures('第一行正常\n第二行 分享 -403 风控\n第三行正常')
    assert.ok(hit.risk403.includes('-403'))
})

test('computeExp 仍按计划口径估算,带估算标记', () => {
    const view = computeExp({ classify: { ok: true }, target: 5 })
    assert.equal(view.login, '已得 5')
    assert.equal(view.watch, '已得 5')
    assert.equal(view.share, '已得 5')
    assert.equal(view.coins, '已得 50')
    assert.equal(view.total, 65)
    assert.equal(view.estimated, true)
    const failed = computeExp({ classify: { shareFailed: true }, target: 5 })
    assert.equal(failed.share, '未完成')
    assert.equal(failed.total, 60)
    assert.equal(computeExp({ classify: {}, target: 0 }).coins, '跳过')
    assert.equal(computeExp({ classify: { cookieInvalid: true }, target: 0 }).login, '失败')
})

test('sanitizeDetail 净化症状里的真实日志行', () => {
    const line = '[12:30:26 INF] 领取任务失败：{"Code":6007000,"Message":"请将客户端更新至最新版本"}'
    const clean = sanitizeDetail(line)
    assert.ok(!clean.includes('INF'), clean)
    assert.ok(!clean.includes('{'), clean)
    assert.ok(clean.includes('6007000'), clean)
    assert.ok(!/[()（）]/.test(clean), clean)
})

test('sanitizeDetail 去掉圆括号并超长截断', () => {
    assert.ok(!/[()（）]/.test(sanitizeDetail('投币失败(风控)')))
    assert.ok(sanitizeDetail('x'.repeat(200)).length <= 60)
})

test('detectFeatures 存的是净化后的 detail', () => {
    assert.equal(detectFeatures('分享 -403 账号异常').risk403, '分享 -403 账号异常')
    const big = detectFeatures('[12:30:26 INF] 领取任务失败：{"Code":6007000,"Message":"请将客户端更新至最新版本"}')
    assert.ok(!big.bigPointFlaky.includes('INF'))
    assert.ok(big.bigPointFlaky.includes('6007000'))
})

// 2026-10-12 实跑:通知说「漫画:签到失败」,而日志里漫画签到是成功的 —— 旧实现把 manga 系在
// 与漫画无关的 task352(投币选视频时排行榜风控)上。改为读漫画流程自己的结果行。
const MANGA_OK = [
    '  [12:14:14 INF] ---开始 漫画签到 ---',
    '  [12:14:27 INF] 【签到结果】成功',
    '  [12:14:27 INF] -------结束-------',
    '  [12:14:27 INF] ---开始 漫画阅读 ---',
    '  [12:14:43 INF] 【漫画阅读】成功',
    '  [12:14:43 INF] FlowCompleted 漫画任务'
].join('\n')

test('漫画:各自读自己流程的结果行', () => {
    assert.deepEqual(readMangaFacts(MANGA_OK), { sign: 'ok', read: 'ok', benefit: null })
})

test('漫画签到失败如实报告', () => {
    const out = ['  [1 INF] ---开始 漫画签到 ---', '  [2 ERR] 【签到结果】失败', '  [2 ERR] 【原因】接口 500'].join('\n')
    assert.equal(readMangaFacts(out).sign, 'failed')
})

test('没有漫画段时是 unknown,不冒充成功', () => {
    assert.deepEqual(readMangaFacts('  [1 INF] 别的日志'), { sign: 'unknown', read: 'unknown', benefit: null })
})

test('漫画权益:原因 null 归一为没有原因', () => {
    const out = ['  [1 INF] ---开始 领取大会员漫画权益 ---', '  [2 INF] 【领取结果】失败', '  [3 INF] 【原因】null'].join('\n')
    assert.deepEqual(readMangaFacts(out).benefit, { status: 'failed', reason: null })
})

test('漫画权益:有真原因时带上,成功时也如实记录', () => {
    const bad = ['  [1 INF] ---开始 领取大会员漫画权益 ---', '  [2 INF] 【领取结果】失败', '  [3 INF] 【原因】接口返回 500'].join('\n')
    assert.deepEqual(readMangaFacts(bad).benefit, { status: 'failed', reason: '接口返回 500' })
    const good = ['  [1 INF] ---开始 领取大会员漫画权益 ---', '  [2 INF] 【领取结果】成功'].join('\n')
    assert.deepEqual(readMangaFacts(good).benefit, { status: 'ok', reason: null })
})

test('权益的原因只认自己那一段,不串到后面的日志', () => {
    const out = [
        '  [1 INF] ---开始 领取大会员漫画权益 ---',
        '  [2 INF] 【领取结果】失败',
        '  [2 INF] FlowCompleted 漫画权益任务',
        '  [9 INF] 【原因】这是别的任务的'
    ].join('\n')
    assert.equal(readMangaFacts(out).benefit.reason, null)
})

// 2026-10-12 第二次跑时实测:漫画签到返回 {"code":1,"msg":"不能重复签到~"} 被上游记成失败,
// 于是消息里出现「漫画:签到失败」—— 与实际相反(今天早就签过了)。
const MANGA_DUP = [
    '  [18:52:46 INF] ---开始 漫画签到 ---',
    '  [18:52:46 DBG] 发起请求：[POST] "https://manga.bilibili.com/twirp/..."',
    '  [18:52:48 DBG] 返回Content：{"code":1, "msg":"不能重复签到~"}',
    '  [18:52:48 INF] 【签到结果】失败',
    '  [18:52:48 INF] -------结束-------'
].join('\n')

test('「不能重复签到」识别为今日已签到,而不是失败', () => {
    assert.equal(readMangaFacts(MANGA_DUP).sign, 'already')
})

test('只有实打实的失败才算失败', () => {
    const hard = [
        '  [1 INF] ---开始 漫画签到 ---',
        '  [2 INF] 【签到结果】失败',
        '  [3 INF] 接口炸了'
    ].join('\n')
    assert.equal(readMangaFacts(hard).sign, 'failed')
})

test('权益已领取也识别为 already', () => {
    const out = [
        '  [1 INF] ---开始 领取大会员漫画权益 ---',
        '  [2 INF] 【领取结果】失败',
        '  [3 INF] 【原因】null',
        '  [4 WRN] 本月已领取过'
    ].join('\n')
    assert.equal(readMangaFacts(out).benefit.status, 'already')
})
