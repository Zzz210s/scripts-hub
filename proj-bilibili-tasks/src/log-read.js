// Console 日志的读取与净化(纯函数):把上游那段给人看代码的日志变成能给用户看的一句话。
// 从 classify.js 拆出来 —— 那里只留「特征表 + 归类 + 经验口径」。2026-10-25 拆分,起因是
// classify.js 涨到 221 行(项目硬规则:自研文件 ≤200 行)。
const DETAIL_LIMIT = 60
const BRACES = /["{}[\]]/g
const PARENS = /[（）()]/g
const SEPARATORS = /[：:，,；;]/g

/** 把一行 Console 原始日志净化成能进消息的短句:去日志前缀/JSON 片段与字段名残留,
 *  保留错误码数字,换掉圆括号,压空白,硬上限 60 字符。无有效信息时返回空串。 */
export function sanitizeDetail(line = '') {
    let text = String(line ?? '')
    text = text.replace(/^\s*\[[^\]]*\]\s*/, '')                       // [12:30:26 INF] / [2026-10-11 12:30:26 INF]
    // 异常类名、命名空间与堆栈帧是给人看代码的,不该出现在给用户的消息里
    // 2026-10-25 实测:上游抛异常时这里会把 `Ray.BiliBiliTool.Domain.Exceptions.BiliBusinessExceptio`
    // 这种半截类名塞进「原因:」(60 字截断正好切在 Exception 中间)。
    text = text.replace(/\bat\s+[\w.`]+\s*\([^)]*\)/g, ' ')            // 堆栈帧
    text = text.replace(/\b(?:[A-Za-z_]\w*\.)+[A-Za-z_]\w*/g, ' ')       // 命名空间/类名 `A.B.C`
    text = text.replace(/\b[A-Za-z_]\w*(?:Exception|Error)\b/g, ' ')      // 裸类名
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
function segment(stdout, start) {
    const lines = String(stdout ?? '').split(/\r?\n/)
    const at = lines.findIndex((line) => line.includes(start))
    if (at === -1) return null
    const body = []
    for (const line of lines.slice(at + 1)) {
        if (line.includes('结束') || line.includes('---开始')) break
        body.push(line)
    }
    return body.join('\n')
}

const verdict = (value) => {
    if (value === null) return 'unknown'
    if (/成功|√|\bok\b/i.test(value)) return 'ok'
    if (/失败|×|\berror\b/i.test(value)) return 'failed'
    return 'unknown'
}

const NO_REASON = /^(null|undefined|空|无|nil|-|—)$/i
// 上游把这些当「失败」报(响应码非 0),对用户来说却是「今天/这个月已经做过了」。
// 2026-10-12 实测:第二次跑时漫画签到返回 `{"code":1,"msg":"不能重复签到~"}` 而被记为失败,
// 结果消息里写成「漫画:签到失败」—— 与事实不符,必须识别为 already。
const ALREADY = /不能重复签到|重复签到|已经签到|已签到|今日已签|重复领取|已经领取|已领取|已完成|已参与/

/** 在切好的段里找 marker 行并取其后值。 */
function readResultAfterIn(text, marker) {
    for (const line of String(text ?? '').split(/\r?\n/)) {
        const index = line.indexOf(marker)
        if (index === -1) continue
        const value = line.slice(index + marker.length).trim()
        return value || null
    }
    return null
}

/** 在一段文本里取结果行紧跟着的【原因】(两行相邻才认)。 */
function readReasonAfterResultIn(text, resultMarker) {
    const lines = String(text ?? '').split(/\r?\n/)
    for (let i = 0; i < lines.length - 1; i++) {
        if (!lines[i].includes(resultMarker)) continue
        const index = lines[i + 1].indexOf('【原因】')
        if (index === -1) return null
        const value = lines[i + 1].slice(index + '【原因】'.length).trim()
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
    const signText = segment(stdout, '开始 漫画签到')
    const readText = segment(stdout, '开始 漫画阅读')
    const benefitText = segment(stdout, '开始 领取大会员漫画权益')

    // 段内出现「不能重复签到」这类字样时,即使响应码非 0 也当「已经做过」
    const judge = (text, marker) => {
        // 段落整个不存在 = 这个任务这次没跑(没启用/被跳过),别报「结果未知」——那会让
        // 一个没发生的事看起来像出了事。只有跑了但读不出结果才算 unknown。
        if (text === null) return 'skipped'
        const result = verdict(readResultAfterIn(text, marker))
        if (result !== 'unknown' && ALREADY.test(text)) return 'already'
        return result
    }

    let benefit = null
    if (benefitText !== null) {
        const result = verdict(readResultAfterIn(benefitText, '【领取结果】'))
        benefit = {
            status: result === 'failed' && ALREADY.test(benefitText) ? 'already' : result,
            reason: readReasonAfterResultIn(benefitText, '【领取结果】')
        }
    }
    // 签到段没跑但阅读段跑了?那只报阅读;两个都没跑就是 skipped
    const sign = judge(signText, '【签到结果】')
    const read = judge(readText, '【漫画阅读】')
    const both = sign === 'skipped' && read === 'skipped'
    return { skipped: both, sign, read, benefit }
}
