// 通知分发:目前只有一条通道 —— 企业微信群机器人 webhook。
// 微信 ClawBot(iLink)通道已于 2026-09-20 移除:它的 context_token 只在用户
// 24 小时内给机器人发过消息时有效,过期后主动推送必然失败,无法无人值守使用。
import { isConfigured as wecomConfigured, sendWecom } from './wecom.js'

/** { wecom: true|false } —— 企业微信通道是否已配置。 */
export function channelStatus() {
    return { wecom: wecomConfigured() }
}

/**
 * 发送文本,返回一行结果说明(不抛网络错误,只把失败写进结果里)。
 * 完全没配置通道时抛错,便于调用方明确提示。
 */
export async function broadcast(text) {
    if (!channelStatus().wecom) {
        throw new Error('未配置企业微信机器人 webhook:请把地址写入 wechat-bridge/data/wecom-webhook.txt')
    }

    try {
        await sendWecom(text)
        return ['企业微信: 成功']
    } catch (error) {
        return [`企业微信: 失败(${error?.message ?? error})`]
    }
}
