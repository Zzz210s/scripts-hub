// 日报渲染:挑战行 / 福利行 / 整条日报。与传输层(src/notify.js)分开 —— 这里只拼文本,不发请求。
// 文案硬规则:不用圆括号,补充说明一律 · 分隔,不用 emoji(2026-10-02 用户定的)。
function hours(minutes) {
    return (minutes / 60).toFixed(1)
}

function hoursFromSeconds(seconds) {
    return (Number(seconds) / 3600).toFixed(1)
}

/**
 * 总进度行:优先用挑战接口的秒数(与完赛判定同一本账),没有挑战数据才回落计划的分钟数。
 * 形如 `进度:3.3 / 30.0 小时 · 差 26.7 小时 · 今日 204 分钟`。
 */
export function renderProgressLine(challenge, plan) {
    const active = (challenge?.list ?? [])[0]
    const todayMinutes = Number(plan?.todayMinutes) || 0
    if (active && Number(active.targetSeconds) > 0) {
        const done = Number(active.readSeconds) || 0
        const target = Number(active.targetSeconds) || 0
        const left = Math.max(0, target - done)
        const tail = left <= 0 ? '已达标' : `差 ${hoursFromSeconds(left)} 小时`
        return `进度:${hoursFromSeconds(done)} / ${hoursFromSeconds(target)} 小时 · ${tail} · 今日 ${todayMinutes} 分钟`
    }
    const fields = (plan?.deficitMinutes ?? 0) <= 0 ? '已达标' : `差 ${plan.deficitMinutes} 分钟`
    return `进度:${fields} · 今日 ${todayMinutes} 分钟`
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
    // 只有「确实申请领取过、但没能自证」才算信号:
    // 没有可领时接口也回 verified=false(压根没领),那不该报 —— 2026-10-11 实测这个假警报每天都可能响。
    const unverified = (weekly?.claimed ?? []).some(item => item.verified === false)
        || (welfare?.claimed === true && welfare?.verified === false)
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

    // 首行报**总进度**:签到是每天的事,阅读时长看的是挑战累计够了没有。
    // 2026-10-31 用户要求把「今日 X 分钟 / 目标 Y 分钟」换成总进度。
    lines.push(renderProgressLine(challenge, plan))

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
    // 进度来源与缺口写进日报:2026-10-30 那次,消息里看不出「统计口径」在哄人,发现时已经晚了。
    if (plan.unreachable) {
        lines.push(`警告:还差 ${plan.deficitMinutes} 分钟,按每日上限 ${config.dailyCapMinutes} 分钟也补不完`)
    }
    if (plan.progressSource === 'stats') lines.push('注意:挑战接口没读到,今日目标按统计口径算,可能偏乐观')
    // 窗口不够时目标被下调,缺口会落到后面几天 —— 这正是「每天都差一点」的开端,必须说出来。
    if (plan.windowCapped) {
        lines.push(`注意:本轮窗口只够 ${plan.windowMinutes} 分钟,下一轮 timer 会接着补 · 时长达标前一直插空跑`)
    }
    if (config.windowAssumed) lines.push('提醒:挑战起止日期用的是默认值,请核对')
    return lines.join('\n').trimEnd()
}
