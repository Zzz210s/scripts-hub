// 企业微信群机器人推送:脱敏、按 UTF-8 字节截断、超时与退避重试。零依赖。
import fs from 'node:fs'

const TEXT_LIMIT_BYTES = 2048
const TIMEOUT_MS = 10000

export function maskSecret(text) {
    return String(text)
        .replace(/(wr_skey=)[^;'"\s]+/gi, '$1****')
        .replace(/(wr_rt=)[^;'"\s]+/gi, '$1****')
        .replace(/(key=)[A-Za-z0-9-]{6,}/g, '$1****')
        .replace(/(wrk-)[A-Za-z0-9_-]{6,}/g, '$1****')
}

export function truncateText(text, limitBytes = TEXT_LIMIT_BYTES) {
    let out = ''
    let used = 0
    for (const char of String(text)) {
        const size = Buffer.byteLength(char, 'utf8')
        if (used + size > limitBytes) break
        out += char
        used += size
    }
    return out
}

export function loadWebhook(file) {
    if (!file || !fs.existsSync(file)) return ''
    return fs.readFileSync(file, 'utf8').trim()
}

export async function sendWecom(text, options = {}) {
    const webhook = options.webhook ?? loadWebhook(options.webhookFile)
    if (options.dryRun) return { ok: true, note: 'dry-run 未发送' }
    if (!webhook) return { ok: false, error: '未配置企业微信 webhook' }

    const fetchImpl = options.fetchImpl ?? globalThis.fetch
    const body = JSON.stringify({ msgtype: 'text', text: { content: truncateText(maskSecret(text)) } })
    let lastError = ''
    for (const wait of [0, 1000, 4000, 12000]) {
        if (wait) await new Promise(resolve => setTimeout(resolve, wait))
        try {
            const response = await fetchImpl(webhook, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
                signal: AbortSignal.timeout(TIMEOUT_MS)
            })
            const payload = await response.json().catch(() => ({}))
            if (payload.errcode === 0) return { ok: true }
            lastError = `errcode=${payload.errcode} ${payload.errmsg ?? ''}`
        } catch (error) {
            lastError = error?.message ?? String(error)
        }
    }
    return { ok: false, error: lastError }
}

function hours(minutes) {
    return (minutes / 60).toFixed(1)
}

function hoursFromSeconds(seconds) {
    return (Number(seconds) / 3600).toFixed(1)
}

/**
 * 挑战行:有接口数据时每条挑战一行,且两条都顶格(第一条带「挑战:」,第二条不带前缀);
 * 否则回落累计口径。文案不用圆括号,补充说明一律用 · 分隔。
 * 奖励明细(达标奖/超额奖)不再进日报 —— 太啰嗦,且挑战详情接口本身就能查到。
 */
export function renderChallengeLines(challenge, plan, config) {
    const list = challenge?.list ?? []
    // 只有接口不可用时才回落。接口正常但列表为空(未报名 / 已结束)不能当成还在进行 —— 那会报出一个不存在的挑战
    if (!list.length) {
        if (challenge?.ok) return ['挑战:无进行中的挑战']
        const slack = plan.failableDays <= 0 ? '不能再漏天数' : `还可漏 ${plan.failableDays} 天`
        return [`挑战:累计 ${hours(plan.minutesSoFar)} / ${hours(config.requiredMinutes)} 小时 · 剩 ${plan.remainingDays} 天 · 有效 ${plan.validDaysSoFar ?? 0}/${config.requiredValidDays} · ${slack}`]
    }
    return list.map((entry, index) => {
        const parts = [
            `${entry.isPaid ? '付费' : '免费'} ${entry.totalDays} 天`,
            `${hoursFromSeconds(entry.readSeconds)} / ${hoursFromSeconds(entry.targetSeconds)} 小时`,
            `已读 ${entry.readDays}/${entry.targetDays} 天`
        ]
        // 完赛(天数与时长双达标)后不再报剩余天数,直接说清结果
        if (entry.done) {
            parts.push('已完赛')
            if (entry.remainDays > 0) parts.push(`提前 ${entry.remainDays} 天`)
        } else {
            parts.push(`剩 ${entry.remainDays} 天`)
            parts.push(entry.canMiss <= 0 ? '不能再漏天数' : `还可漏 ${entry.canMiss} 天`)
        }
        return (index === 0 ? '挑战:' : '') + parts.join(' · ')
    })
}

/**
 * 福利行只报三个数:书币余额 / 即将过期 / 体验卡天数(2026-10-03 用户要求极简)。
 * 本周档位总览与逐档领取明细不再进消息 —— 它们仍落在 data/history.json 与运行日志里;
 * 领取失败与未自证照旧报出来,那是需要看的信号。补充说明同样不用圆括号。
 */
export function renderWelfareLine({ welfare, weekly, balance, memberCard } = {}) {
    const parts = []
    if (balance?.ok) {
        parts.push(`书币余额 ${Number(balance.balance ?? 0).toFixed(2)}`)
        parts.push(`即将过期 ${Number(balance.expiryBalance ?? 0).toFixed(2)}`)
    }
    // 体验卡余额读不到就不显示;只有它没有书币余额时也照样单列
    if (memberCard?.ok) parts.push(`体验卡 ${Number(memberCard.freeCardDays ?? 0)} 天`)
    // verified === undefined 是旧数据,不臆断也不提示;只有明确自证失败才提醒核对
    const unverified = (weekly?.claimed ?? []).some(item => item.verified === false) || welfare?.verified === false
    if (unverified) parts.push('领取未自证,建议核对')
    if (weekly?.failed?.length) parts.push('档位领取失败,下次运行重试')
    // 阅读器书币查询失败多半是瞬时网络问题,不打扰;领取失败才需要知道
    else if (welfare && welfare.ok === false && welfare.reason !== 'query-failed') parts.push('阅读器书币领取失败,下次运行重试')
    if (!parts.length) parts.push('暂无可领')
    return `福利:${parts.join(' · ')}`
}

/** 日报:官方读回的数字 + 挑战进度 + 福利。按块分行,便于扫读。 */
export function buildReport(options) {
    // 数据类入参收口成 data(run.js / cli.js 用);顶层同名字段保留兼容,便于既有调用与测试
    const { plan, run, config, date, accountName, data, ...rest } = options
    const { welfare, weekly, challenge, balance, memberCard } = { ...rest, ...(data ?? {}) }
    const headline = run === null || run === undefined
        ? '预览,未运行'
        // 动作词与微软积分那边统一(2026-10-03):不再写"运行异常" —— "有失败"更准,部分失败也算成功跑完
        : (run.ok ? '运行成功' : '运行有失败')
    const lines = [`微信读书签到 · ${accountName ?? '微信读书'} · ${date} · ${headline}`, '']

    const gap = plan.targetMinutes - plan.todayMinutes
    lines.push(`阅读:今日 ${plan.todayMinutes} 分钟 · 目标 ${plan.targetMinutes} 分钟 · ${gap <= 0 ? '已达标' : `还差 ${gap} 分钟`}`)

    if (run) {
        // 「本次」行只报需要你看的状态:凭据续期与计入异常 / 读回失败。
        // 上报分钟、请求次数与结果只进运行日志与 history.json —— 结果已由标题行给出,
        // 再报一遍只是噪音(2026-10-03 用户要求);两种状态都没有时整行不出现。
        const parts = []
        if (run.renewal) parts.push(run.renewal)
        if (run.alert) parts.push(run.alert)
        if (parts.length) lines.push(`本次:${parts.join(' · ')}`)
    }

    lines.push(...renderChallengeLines(challenge, plan, config))

    lines.push(renderWelfareLine({ welfare, weekly, balance, memberCard }))

    if ((plan.validNeeded ?? 0) > Math.max(0, (plan.remainingDays ?? 0) - 1)) {
        lines.push('警告:剩余天数已不够凑齐有效天数,本轮无法完成,建议尽早开始下一轮')
    }
    if (plan.emergency) lines.push('注意:进度落后,已进入紧急模式,今天按每日上限跑')
    if (config.windowAssumed) lines.push('提醒:挑战起止日期用的是默认值,请核对')
    return lines.join('\n').trimEnd()
}
