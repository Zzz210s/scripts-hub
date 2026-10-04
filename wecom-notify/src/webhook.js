// webhook 地址的解析与脱敏。
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_WEBHOOK_FILE = 'wecom-webhook.txt'

const WEBHOOK_PATTERN = /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[A-Za-z0-9_-]+$/

/** 校验是否为合法的企业微信群机器人 webhook 地址。 */
export function isWebhookUrl(value) {
    return typeof value === 'string' && WEBHOOK_PATTERN.test(value.trim())
}

/** 脱敏:只保留主机与参数名,不泄露 key。 */
export function maskWebhook(url) {
    if (!url) return '(未配置)'
    return 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=****'
}

/** 读取文件里第一行有效内容(忽略空行与 # 注释)。 */
export function readWebhookFile(filePath) {
    try {
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
        for (const line of lines) {
            const value = line.trim()
            if (value && !value.startsWith('#')) return value
        }
    } catch {
        return null
    }
    return null
}

/**
 * 按优先级解析 webhook:显式参数 > 环境变量 > 文件。
 * @returns {{ url: string, source: string }}
 */
export function resolveWebhook({ url, file, cwd = process.cwd(), env = process.env } = {}) {
    if (url) return { url: url.trim(), source: '参数 --webhook' }

    const fromEnv = env.WECOM_WEBHOOK_URL?.trim()
    if (fromEnv) return { url: fromEnv, source: '环境变量 WECOM_WEBHOOK_URL' }

    const filePath = file ?? env.WECOM_WEBHOOK_FILE ?? path.join(cwd, DEFAULT_WEBHOOK_FILE)
    const fromFile = readWebhookFile(filePath)
    if (fromFile) return { url: fromFile, source: `文件 ${filePath}` }

    throw new Error(
        `未找到 webhook 地址:请用 --webhook 指定、设置 WECOM_WEBHOOK_URL,或把地址写入 ${filePath}`
    )
}
