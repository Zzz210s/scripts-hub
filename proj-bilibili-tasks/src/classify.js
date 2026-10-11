// Console 退出码 + stdout 特征 -> 运行结论(纯)。不解析上游日志格式,只认特征串。
// `-403` 与 `352` 是纯数字串(时间戳/aid/余额里都会出现),必须与同行的中文关键词同现才算命中。
const FEATURES = {
    risk403: { markers: ['-403'], keywords: ['投币', '观看', '分享', '风控', '账号异常', '操作失败'] },
    task352: { markers: ['352'], keywords: ['投币', '观看', '分享', '任务', '失败', '异常'] },
    cookieInvalid: { markers: ['账号未登录', '未登录', 'login required', 'not logged in'] },
    voucherTaken: { markers: ['69801', '你已领取过该权益'] },
    bigPointFlaky: { markers: ['6007000'] },
    shareFailed: { markers: ['分享失败', '分享被拒绝', '分享被风控'] },
    watchFailed: { markers: ['观看失败', '观看视频失败'] }
}

const NOTES = {
    risk403: { label: '账号级风控', note: '账号级风控 · 会自行过期' },
    task352: { label: '任务失败 352', note: '任务接口返回 352' },
    cookieInvalid: { label: '登录态失效', note: '登录态失效' },
    bigPointFlaky: { label: '接口要求升级客户端', note: '接口要求升级客户端' },
    shareFailed: { label: '分享失败', note: '分享被风控拒绝' },
    watchFailed: { label: '观看失败', note: '观看视频失败' }
}

const DETAIL_LIMIT = 60
const BRACES = /["{}[\]]/g
const PARENS = /[（）()]/g
const SEPARATORS = /[：:，,；;]/g

/** 把一行 Console 原始日志净化成能进消息的短句:去日志前缀/JSON 片段与字段名残留,
 *  保留错误码数字,换掉圆括号,压空白,硬上限 60 字符。无有效信息时返回空串。 */
export function sanitizeDetail(line = '') {
    let text = String(line ?? '')
    text = text.replace(/^\s*\[[^\]]*\]\s*/, '')                       // [12:30:26 INF] / [2026-10-11 12:30:26 INF]
    text = text.replace(/\{[^{}]*\}/g, (fragment) => {                 // JSON 片段只留错误码
        const codes = [...fragment.matchAll(/"(?:Code|code)"\s*:\s*(-?\d+)/g)].map((m) => m[1])
        return codes.length ? ` ${codes.join(' ')} ` : ' '
    })
    text = text.replace(BRACES, ' ').replace(PARENS, ' ')
    text = text.replace(SEPARATORS, ' · ').replace(/\s+/g, ' ').trim()
    text = text.replace(/(?:\s*·\s*)+/g, ' · ').replace(/^·\s*|\s*·$/g, '').trim()
    return text.length > DETAIL_LIMIT ? text.slice(0, DETAIL_LIMIT).trim() : text
}

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
    const notes = (name, detail) => `${NOTES[name]?.note ?? name} · ${detail}`
    let failures = Object.entries(hit)
        .filter(([name]) => name !== 'voucherTaken')   // 69801 是正常结果,不算失败
        .map(([name, detail]) => ({ kind: name, label: NOTES[name]?.label ?? name, note: notes(name, detail), ignored: name === 'bigPointFlaky' }))

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
        task352: has('task352'),
        bigPointFlaky: has('bigPointFlaky'),
        voucherTaken: has('voucherTaken'),
        timedOut: Boolean(timedOut),
        exitCode
    }
}

/** 每日任务经验行由薄壳自己算(接口取不到时的回落口径),上限 65,失败项显示失败并计入已取到的部分。
 *  与 expFromReward 同形,estimated=true 表示这是计划口径估算而非接口真值。 */
export function computeExp({ classify = {}, target = 0 } = {}) {
    const missing = []
    const login = classify.cookieInvalid ? '失败' : '已得 5'
    const watch = classify.watchFailed ? '未完成' : '已得 5'
    const share = classify.shareFailed ? '未完成' : '已得 5'
    const coins = target > 0 ? `已得 ${target * 10}` : '跳过'
    if (classify.cookieInvalid) missing.push('login')
    if (classify.watchFailed) missing.push('watch')
    if (classify.shareFailed) missing.push('share')
    if (target <= 0) missing.push('coins')
    const total = (classify.cookieInvalid ? 0 : 5) + (classify.watchFailed ? 0 : 5)
        + (classify.shareFailed ? 0 : 5) + (target > 0 ? target * 10 : 0)
    return { login, watch, share, coins, total, missing, estimated: true }
}
