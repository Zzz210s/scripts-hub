// 按"剩余天数 / 剩余时长"算出今天该读多久,并拆成不超过单段上限的段落。
//
// 判据来自官方统计(秒),这里统一换算成分钟。挑战口径:
//   30 天挑战 = 打卡 ≥29 天 且 累计 ≥30 小时;有效日 = 当天阅读 > 5 分钟。
// 统计会漏计少量分钟,所以目标里加一点余量(slackMinutes)。
// 目标不是"今天应该读多少",而是"今天还读得到多少":超出当日窗口的部分分给后面几天。
import { availableWindow } from './clock.js'

const EMERGENCY_MINUTES_PER_DAY = 90

function dayIndex(iso) {
    return Math.floor(new Date(`${iso}T00:00:00`).getTime() / 86400000)
}

export function localDay(input = new Date()) {
    const date = input instanceof Date ? input : new Date(input)
    const pad = value => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value))
}

/** 挑战窗口内的已读分钟:把官方分桶里落在 [start, today] 的秒数加起来。 */
export function minutesInWindow(buckets, startDay, today = localDay()) {
    const seconds = (buckets ?? [])
        .filter(bucket => bucket.day >= startDay && bucket.day <= today)
        .reduce((sum, bucket) => sum + bucket.seconds, 0)
    return Math.round(seconds / 60)
}

export function splitSections(totalMinutes, sectionMinutes) {
    const sections = []
    let left = Math.max(0, totalMinutes)
    while (left > 0) {
        const minutes = Math.min(sectionMinutes, left)
        sections.push({ minutes })
        left -= minutes
    }
    return sections
}

/**
 * @param {object} input
 * @param {Date} input.now 当前时间
 * @param {object} input.config 挑战与运行参数(见 config.js)
 * @param {Array<{day:string, seconds:number}>} input.buckets 官方分桶
 * @param {number} input.todaySeconds 今天已计入的秒数
 * @param {number} [input.attempts] 今天已经尝试过几次(算剩余窗口用)
 */
export function planDay(input) {
    const { now, config, buckets, todaySeconds, attempts = 0 } = input
    const today = localDay(now)
    const startDay = config.challengeStart
    const endDay = config.challengeEndsOn
    const minutesSoFar = minutesInWindow(buckets, startDay, today)
    const todayMinutes = Math.round(todaySeconds / 60)

    const remainingMinutes = Math.max(0, config.requiredMinutes - minutesSoFar)
    const remainingDays = Math.max(1, dayIndex(endDay) - dayIndex(today) + 1)

    // 「理想目标」:把剩余量均摊到剩余天数。总量已达标时只保留最小有效时长,维持连续打卡
    const planned = remainingMinutes <= 0
        ? config.minValidMinutes
        : clamp(Math.ceil(remainingMinutes / remainingDays) + config.slackMinutes, config.minValidMinutes, config.dailyCapMinutes)

    // 「今天可达」:已经读到的 + 本次窗口内还能读的。窗口(安静时段 / 关机避让 / 剩余次数)不够时
    // 目标按可达值下调,缺口由后面的日子按 剩余量/剩余天数 自然分摊;有效日下限不可破。
    const windowMinutes = availableWindow(now, config, attempts)
    const reachable = Math.max(config.minValidMinutes, Math.min(planned, todayMinutes + windowMinutes))
    const targetMinutes = Math.min(reachable, config.dailyCapMinutes)
    const windowCapped = targetMinutes < planned

    // 本次会话最多写单次上限:超出的部分留给下一次触发,免得底座跑到一半被看门狗掐断
    const runCap = config.runTimeoutMinutes ?? 100
    const stillNeeded = Math.max(0, targetMinutes - todayMinutes)
    const runMinutes = Math.min(stillNeeded, runCap)

    // 有效天数:挑战要求 29/30 天,所以"还能失败几天"同时受时间配额与有效天数两个约束,
    // 取两者较小值。只算时间会给出"还能失败 30 天"这种明显不对的结论(2026-10-01 用户指出)。
    const validSeconds = config.minValidMinutes * 60
    const inWindow = (buckets ?? []).filter(bucket => bucket.day >= startDay && bucket.day <= today)
    const validDaysSoFar = inWindow.filter(bucket => bucket.seconds >= validSeconds).length
    const todayValid = todaySeconds >= validSeconds
    const validNeeded = Math.max(0, config.requiredValidDays - validDaysSoFar)
    const daySlack = Math.max(0, remainingDays - validNeeded - (todayValid ? 1 : 0))

    const neededDays = Math.ceil(remainingMinutes / config.dailyCapMinutes)
    const timeSlack = Math.max(0, remainingDays - neededDays)
    const failableDays = Math.min(daySlack, timeSlack)

    // 今天实际能补的扣掉后,后面每天要扛多少 —— 超过紧急线就提示
    const afterToday = Math.max(0, remainingMinutes - stillNeeded)
    const futureDays = Math.max(1, remainingDays - 1)
    const emergency = afterToday / futureDays > EMERGENCY_MINUTES_PER_DAY

    return {
        today,
        targetMinutes,
        todayMinutes,
        minutesSoFar,
        remainingMinutes,
        remainingDays,
        validDaysSoFar,
        validNeeded,
        daySlack,
        timeSlack,
        failableDays,
        emergency,
        plannedMinutes: planned,
        windowMinutes,
        windowCapped,
        runMinutes,
        stillNeeded,
        sections: splitSections(runMinutes, config.sectionMinutes),
        reason: `已读 ${minutesSoFar} 分钟,剩 ${remainingMinutes} 分钟 / ${remainingDays} 天;今日目标 ${targetMinutes} 分钟(已完成 ${todayMinutes})${windowCapped ? `,按今日窗口 ${windowMinutes} 分钟下调` : ''};本次会话 ${runMinutes} 分钟;有效天数 ${validDaysSoFar}/${config.requiredValidDays},还能漏 ${failableDays} 天`
    }
}
