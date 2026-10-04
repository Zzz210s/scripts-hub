// 「需要你处理」这一类提醒的文案。
//
// 2026-10-04 用户要求:企业微信不再接收「正常跳过」的消息(今天已经跑过 / 尝试次数用尽 /
// 内存不足),这类跳过只写运行日志。对应的文案与分支已经从本文件删除 —— 不留开关,
// 避免以后又被打开。保留导出名(isSilentSkip / buildSkipMessage)只是为了让调用方不必改。
import { localDay } from './report.js'

const ACTION = '需要你处理'

/** 只有「需要你处理」才推送;其余原因一律静默(只写运行日志)。 */
export function isSilentSkip(mode) {
    return mode !== 'nocreds'
}

/** 返回要推送的文案;正常跳过返回 null,调用方只记日志、不发送。 */
export function buildSkipMessage({ mode }) {
    if (mode !== 'nocreds') return null

    const head = `微软积分 · ${localDay(new Date())}`
    return [
        `${head} · ${ACTION}`,
        '',
        '请你:把账号邮箱与密码写进 .env,替换里面的占位邮箱',
        '原因:还没有配置真实账号 · .env 里仍是占位邮箱',
        '不处理的后果:每次触发都会被跳过,积分一直不会被领取'
    ].join('\n')
}
