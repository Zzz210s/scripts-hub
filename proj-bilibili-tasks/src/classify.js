// Console 退出码 + stdout 特征 -> 运行结论(纯)。不解析上游日志格式,只认特征串。
// `-403` 与 `352` 是纯数字串(时间戳/aid/余额里都会出现),必须与同行的中文关键词同现才算命中。
const FEATURES = {
    risk403: { markers: ['-403'], keywords: ['投币', '观看', '分享', '风控', '账号异常', '操作失败'] },
    // 2026-10-25 实测:投币一条都没投出去,根因是 WAF 把两个接口临时拦了 ——
    // `/x/web-interface/view` 回 `{"code":-412,"message":"request was banned"}`,榜单回 `-352`。
    // 这两个是「接口被风控」,不是账号被封、也不是脚本坏了,下次触发通常就好了。
    rate412: { markers: ['-412', 'request was banned', 'precondition failed'] },
    // `352` 是纯数字串(时间戳/aid/余额里都会出现),必须与同行的中文关键词同现才算命中
    rate352: { markers: ['352'], keywords: ['投币', '观看', '分享', '任务', '失败', '异常'] },
    cookieInvalid: { markers: ['账号未登录', '未登录', 'login required', 'not logged in'] },
    voucherTaken: { markers: ['69801', '你已领取过该权益'] },
    bigPointFlaky: { markers: ['6007000'] },
    // R2:上游 CookieTaskGuard 超时后会静默跳过整次任务,退出码仍为 0,必须识别出来
    'guard-skipped': { markers: ['登录态检查暂时失败', '本次活动已跳过'] },
    shareFailed: { markers: ['分享失败', '分享被拒绝', '分享被风控'] },
    watchFailed: { markers: ['观看失败', '观看视频失败'] }
}

// 多个特征归一类时在这里合并:同一件事只报一条原因。
const KIND = { rate412: 'rate-limited', rate352: 'rate-limited' }

const NOTES = {
    risk403: { label: '账号级风控', note: '账号级风控 · 会自行过期' },
    'rate-limited': { label: '临时风控拦截', note: 'B站 临时风控拦截 · 该接口稍后再试' },
    cookieInvalid: { label: '登录态失效', note: '登录态失效' },
    bigPointFlaky: { label: '接口要求升级客户端', note: '接口要求升级客户端' },
    'guard-skipped': { label: '运行被上游跳过', note: '运行被上游跳过 · 登录态检查超时 · 未做任何任务' },
    shareFailed: { label: '分享失败', note: '分享被风控拒绝' },
    watchFailed: { label: '观看失败', note: '观看视频失败' }
}

import { sanitizeDetail } from './log-read.js'

// 日志读取类的能力从这里一并导出,调用方(Task 级历史代码与测试)不用改导入路径。
export { sanitizeDetail, readMangaFacts } from './log-read.js'

export function detectFeatures(stdout = '') {
    const hit = {}
    for (const line of String(stdout).split(/\r?\n/)) {
        const low = line.toLowerCase()
        for (const [name, feature] of Object.entries(FEATURES)) {
            if (hit[name]) continue
            if (!feature.markers.some((marker) => low.includes(marker.toLowerCase()))) continue
            if (feature.keywords && !feature.keywords.some((keyword) => low.includes(keyword.toLowerCase()))) continue
            hit[name] = sanitizeDetail(line)
        }
    }
    return hit
}

export function classifyRun({ exitCode = 0, stdout = '', timedOut = false } = {}) {
    const hit = detectFeatures(stdout)
    const notes = (name, detail) => {
        const base = NOTES[name]?.note ?? name
        return detail ? `${base} · ${detail}` : base
    }
    // 同一类只报一条:今天「-352」与「投币未达标」就是一件事的两个说法
    const seen = new Set()
    let failures = []
    for (const [name, detail] of Object.entries(hit)) {
        const kind = KIND[name] ?? name
        if (kind === 'voucherTaken') continue          // 69801 是正常结果,不算失败
        if (seen.has(kind)) continue
        seen.add(kind)
        const retryable = kind === 'rate-limited'
        failures.push({
            kind,
            label: NOTES[kind]?.label ?? kind,
            // 风控拦截的文案已自含结论(该接口稍后再试),再拼上游原文只会把用户绕进去
            note: retryable ? NOTES[kind].note : notes(kind, detail),
            // 风控拦截不单独否定这一轮:投币真的没投出时,由经验真值的「投币未达标」负责报
            ignored: kind === 'bigPointFlaky' || retryable,
            retryable
        })
    }

    if (timedOut) failures.push({ kind: 'timeout', label: '运行超时', note: 'Console 超过薄壳侧超时被杀 · 可重试' })
    if (exitCode !== 0 && !failures.some((failure) => !failure.ignored)) {
        failures.push({ kind: 'exit-code', label: `退出码 ${exitCode}`, note: `Console 退出码 ${exitCode}` })
    }

    const has = (name) => Boolean(hit[name])
    return {
        ok: exitCode === 0 && !failures.some((failure) => !failure.ignored),
        failures,
        risk403: has('risk403'),
        cookieInvalid: has('cookieInvalid'),
        shareFailed: has('shareFailed'),
        watchFailed: has('watchFailed'),
        task352: has('rate352'),
        // 风控拦截:与 352 同源,单独给一个布尔位方便编排层把原因并进「投币未达标」
        rateLimited: Boolean(hit.rate412 || hit.rate352),
        bigPointFlaky: has('bigPointFlaky'),
        guardSkipped: has('guard-skipped'),
        voucherTaken: has('voucherTaken'),
        timedOut: Boolean(timedOut),
        exitCode
    }
}

/** 每日任务经验行由薄壳自己算(接口取不到时的回落口径),上限 65,失败项显示失败并计入已取到的部分。
 *  与 expFromReward 同形,estimated=true 表示这是计划口径估算而非接口真值。 */
export function computeExp({ classify = {}, target = 0 } = {}) {
    const missing = []
    // 被上游整次跳过时什么都没做,不能冒充「已得」
    const skipped = Boolean(classify.guardSkipped)
    const login = skipped ? '未完成' : (classify.cookieInvalid ? '失败' : '已得 5')
    const watch = skipped || classify.watchFailed ? '未完成' : '已得 5'
    const share = skipped || classify.shareFailed ? '未完成' : '已得 5'
    const coins = skipped ? '未完成' : (target > 0 ? `已得 ${target * 10}` : '跳过')
    if (skipped || classify.cookieInvalid) missing.push('login')
    if (skipped || classify.watchFailed) missing.push('watch')
    if (skipped || classify.shareFailed) missing.push('share')
    if (skipped || target <= 0) missing.push('coins')
    const total = (login === '已得 5' ? 5 : 0) + (watch === '已得 5' ? 5 : 0)
        + (share === '已得 5' ? 5 : 0) + (!skipped && target > 0 ? target * 10 : 0)
    return { login, watch, share, coins, total, missing, estimated: true }
}
