// Console 退出码 + stdout 特征 -> 运行结论(纯)。不解析上游日志格式,只认特征串。
// `-403` 与 `352` 是纯数字串(时间戳/aid/余额里都会出现),必须与同行的中文关键词同现才算命中。
const FEATURES = {
    risk403: { markers: ['-403'], keywords: ['投币', '观看', '分享', '风控', '账号异常', '操作失败'] },
    task352: { markers: ['352'], keywords: ['投币', '观看', '分享', '任务', '失败', '异常'] },
    cookieInvalid: { markers: ['账号未登录', '未登录', 'login required', 'not logged in'] },
    voucherTaken: { markers: ['69801', '你已领取过该权益'] },
    bigPointFlaky: { markers: ['6007000'] },
    // R2:上游 CookieTaskGuard 超时后会静默跳过整次任务,退出码仍为 0,必须识别出来
    'guard-skipped': { markers: ['登录态检查暂时失败', '本次活动已跳过'] },
    shareFailed: { markers: ['分享失败', '分享被拒绝', '分享被风控'] },
    watchFailed: { markers: ['观看失败', '观看视频失败'] }
}

const NOTES = {
    risk403: { label: '账号级风控', note: '账号级风控 · 会自行过期' },
    task352: { label: '任务失败 352', note: '任务接口返回 352' },
    cookieInvalid: { label: '登录态失效', note: '登录态失效' },
    bigPointFlaky: { label: '接口要求升级客户端', note: '接口要求升级客户端' },
    'guard-skipped': { label: '运行被上游跳过', note: '运行被上游跳过 · 登录态检查超时 · 未做任何任务' },
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

/** 在 stdout 里定位 `start` 之后、该段结束之前的 `marker` 行,返回 marker 之后的值。
 *  段的边界靠日志里的 `-------结束-------` 与下一个 `---开始 X ---` 夹住 —— 不夹的话,
 *  后面别的任务里的 `【原因】` 会被误当成这一段的(2026-10-12 实测踩到)。 */
function readResultAfter(stdout, start, marker) {
    const lines = String(stdout ?? '').split(/\r?\n/)
    const at = lines.findIndex((line) => line.includes(start))
    if (at === -1) return null
    for (const line of lines.slice(at + 1)) {
        if (line.includes('结束') || line.includes('---开始')) break
        const index = line.indexOf(marker)
        if (index === -1) continue
        const value = line.slice(index + marker.length).trim()
        return value || null
    }
    return null
}

const verdict = (value) => {
    if (value === null) return 'unknown'
    if (/成功|√|\bok\b/i.test(value)) return 'ok'
    if (/失败|×|\berror\b/i.test(value)) return 'failed'
    return 'unknown'
}

const NO_REASON = /^(null|undefined|空|无|nil|-|—)$/i

/** 取「结果行紧跟着的那一行」里的【原因】—— 上游格式是两行相邻;
 *  隔了别的行就不认,避免把后面别段的原因拿过来。 */
function readReasonAfterResult(stdout, start, resultMarker) {
    const lines = String(stdout ?? '').split(/\r?\n/)
    const at = lines.findIndex((line) => line.includes(start))
    if (at === -1) return null
    for (let i = at + 1; i < lines.length - 1; i++) {
        if (!lines[i].includes(resultMarker)) continue
        const next = lines[i + 1]
        const index = next.indexOf('【原因】')
        if (index === -1) return null
        const value = next.slice(index + '【原因】'.length).trim()
        return value && !NO_REASON.test(value) ? value : null
    }
    return null
}

/**
 * 漫画相关的三个事实,各自读自己那段流程的结果行。
 * 2026-10-12 修正:旧实现把 manga 系在与漫画无关的 task352 上(投币选视频时排行榜风控),
 * 于是日志里「漫画签到 成功」被报成「漫画:签到失败」—— 消息必须来自该流程自己的输出。
 */
export function readMangaFacts(stdout = '') {
    const sign = verdict(readResultAfter(stdout, '开始 漫画签到', '【签到结果】'))
    const read = verdict(readResultAfter(stdout, '开始 漫画阅读', '【漫画阅读】'))
    const result = readResultAfter(stdout, '开始 领取大会员漫画权益', '【领取结果】')
    let benefit = null
    if (result !== null) {
        benefit = { status: verdict(result), reason: readReasonAfterResult(stdout, '开始 领取大会员漫画权益', '【领取结果】') }
    }
    return { sign, read, benefit }
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
