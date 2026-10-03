// 开始运行消息:一句话说明哪个程序开始跑,细节交给运行日志与结果消息。
//   微软积分 · <账号数> 个账号 · <日期> · 开始运行 [· 重试]
// 第几次尝试 / 并行度 / 触发方式 / 上次结果都不再进消息(2026-10-03 用户要求),
// 它们由 notify-start.js 打在运行日志里。不用圆括号,分隔符统一 · 。
export const MAX_ATTEMPTS = 3

/**
 * @param {object} input
 * @param {string} input.day 逻辑日 YYYY-MM-DD
 * @param {number} input.accounts 已配置账号数
 * @param {boolean} [input.retry] 是否异常中断后的自动重试,是就在行尾补一个极短提示
 */
export function buildStartMessage({ day, accounts, retry = false }) {
    const head = accounts > 0 ? `微软积分 · ${accounts} 个账号 · ${day}` : `微软积分 · ${day}`
    return `${head} · 开始运行${retry ? ' · 重试' : ''}`
}
