// 跳过与人工处理两类消息的文案。2026-10-03 用户反馈:两类消息长得几乎一样,
// 现在标题与正文都分开写:
//   skip   标题「正常跳过」,正文说清 为什么跳过 / 会不会自动重试 / 不需要你做什么
//   action 标题「需要你处理」,正文第一句就是 请你做什么,再说原因与不做的后果
// 排版与开始/结果消息同一套:标题行 / 空行 / 正文。不用圆括号,分隔符统一 · 。
import { localDay } from './report.js'

const SKIP = '正常跳过'
const ACTION = '需要你处理'

/**
 * @param {object} input
 * @param {string} input.mode memory 内存不足 / handled 当天已跑过 / nocreds 没有配置账号
 * @param {string} [input.arg] memory 的可用内存 MB;handled 的逻辑日
 * @param {number} [input.gained] handled 当天已入账分数
 * @param {boolean} [input.sameDay] handled 的逻辑日是否就是今天
 */
export function buildSkipMessage({ mode, arg, gained = 0, sameDay = true }) {
    const head = `微软积分 · ${localDay(new Date())}`
    const compose = (title, body) => [`${head} · ${title}`, '', ...body].join('\n')

    if (mode === 'nocreds') {
        return compose(ACTION, [
            '请你:把账号邮箱与密码写进 .env,替换里面的占位邮箱',
            '原因:还没有配置真实账号 · .env 里仍是占位邮箱',
            '不处理的后果:每次触发都会被跳过,积分一直不会被领取'
        ])
    }
    if (mode === 'handled') {
        const when = sameDay ? '今天' : `${arg} `
        const gainedText = gained > 0 ? `${sameDay ? '今日' : '当日'} +${gained} 分 · 重复运行不会再有新分` : '当天的积分已经领取过 · 重复运行不会再有新分'
        return compose(SKIP, [
            `原因:${when}已经跑过 · 一天只运行一遍`,
            `已入账:${gainedText}`,
            '后续:下一次自动运行照旧',
            '你需要做什么:不需要'
        ])
    }
    return compose(SKIP, [
        `原因:可用内存不足 · 可用 ${arg}MB 低于启动门槛`,
        '后续:内存空出来后的下一次触发会自动补跑 · 不消耗当天的尝试次数',
        '你需要做什么:不需要'
    ])
}
