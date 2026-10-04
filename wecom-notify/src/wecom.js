// 企业微信群机器人发送实现:字节截断、超时、网络失败重试、errcode 校验。
export const TEXT_MAX_BYTES = 2048
export const MARKDOWN_MAX_BYTES = 4096
export const DEFAULT_TIMEOUT_MS = 10000

/** 按目标字节数截断(按 UTF-8 字节算,避免多字节字符被截半)。 */
export function clampText(content, maxBytes = TEXT_MAX_BYTES) {
    const buffer = Buffer.from(content, 'utf8')
    if (buffer.byteLength <= maxBytes) return content
    const head = buffer.subarray(0, Math.max(0, maxBytes - 3)).toString('utf8')
    return `${head}...`
}

export class WecomError extends Error {
    constructor(message, errcode) {
        super(message)
        this.name = 'WecomError'
        this.errcode = errcode
    }
}

function buildBody(text, msgtype) {
    if (msgtype === 'markdown') {
        return { msgtype: 'markdown', markdown: { content: clampText(text, MARKDOWN_MAX_BYTES) } }
    }
    return { msgtype: 'text', text: { content: clampText(text, TEXT_MAX_BYTES) } }
}

async function postOnce(url, body, fetchImpl, timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        })
        const raw = await res.text()

        let parsed = null
        try {
            parsed = JSON.parse(raw)
        } catch {
            parsed = null
        }

        if (!res.ok) throw new Error(`HTTP ${res.status} ${raw.slice(0, 120)}`)
        if (parsed && parsed.errcode !== 0) {
            throw new WecomError(`企业微信返回 errcode=${parsed.errcode} errmsg=${parsed.errmsg}`, parsed.errcode)
        }
        return parsed ?? {}
    } finally {
        clearTimeout(timer)
    }
}

/**
 * 发送一条消息。
 * @param {string} text 消息内容,超长会自动截断
 * @param {{ webhookUrl: string, msgtype?: 'text'|'markdown', retries?: number,
 *           timeoutMs?: number, fetchImpl?: typeof fetch, sleep?: (ms:number)=>Promise<void>,
 *           onRetry?: (error: Error, attempt: number) => void }} options
 */
export async function sendWecom(text, options) {
    const {
        webhookUrl,
        msgtype = 'text',
        retries = 2,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        fetchImpl = globalThis.fetch,
        sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
        onRetry
    } = options ?? {}

    if (!webhookUrl) throw new Error('sendWecom 需要 webhookUrl')
    if (!text?.trim()) throw new Error('sendWecom 需要非空文本')

    const body = buildBody(text, msgtype)
    let lastError

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await postOnce(webhookUrl, body, fetchImpl, timeoutMs)
        } catch (error) {
            lastError = error
            // errcode 类错误是服务端明确拒绝,重试没有意义(如 key 无效)
            if (error instanceof WecomError || attempt === retries) break
            onRetry?.(error, attempt + 1)
            await sleep(1000 * 2 ** attempt)
        }
    }

    throw lastError
}
