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

export function detectFeatures(stdout = '') {
    const hit = {}
    for (const line of String(stdout).split(/\r?\n/)) {
        const low = line.toLowerCase()
        for (const [name, feature] of Object.entries(FEATURES)) {
            if (hit[name]) continue
            if (!feature.markers.some((marker) => low.includes(marker.toLowerCase()))) continue
            if (feature.keywords && !feature.keywords.some((keyword) => low.includes(keyword.toLowerCase()))) continue
            hit[name] = line.trim().slice(0, 200)
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

/** 每日任务经验行由薄壳自己算,不从上游日志抠数字(上限 65,失败项显示失败并计入已取到的部分)。 */
export function computeExp({ classify = {}, target = 0 } = {}) {
    const login = classify.cookieInvalid ? '失败' : '5'
    const watch = classify.watchFailed ? '观看失败' : '5'
    const share = classify.shareFailed ? '分享失败' : '5'
    const coin = target > 0 ? String(target * 10) : '跳过'
    const total = [login, watch, share].reduce((sum, value) => sum + (Number(value) || 0), 0) + (target > 0 ? target * 10 : 0)
    return { login, watch, share, coin, total }
}
