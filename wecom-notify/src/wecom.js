// 企业微信群机器人发送实现:字节截断、超时、网络失败重试、errcode 校验。
// >>> wecom-core begin —— 三份企业微信发送实现的共同核心,改一处必须同步三处
// 本块在 wecom-notify/src/wecom.js、microsoft-rewards/wechat-bridge/lib/wecom.js、
// weread-signin/src/notify.js 中逐字节一致,由 scripts/check-wecom-drift.mjs 校验。
const WECOM_TEXT_MAX_BYTES = 2048
const WECOM_MARKDOWN_MAX_BYTES = 4096
const WECOM_TIMEOUT_MS = 10000

/** 服务端明确拒绝的 errcode:重试没有意义。 */
class WecomError extends Error {
    constructor(message, errcode) {
        super(message)
        this.name = 'WecomError'
        this.errcode = errcode
    }
}

/** 按 UTF-8 字节截断,多字节字符不会被截半;超长时以 ... 结尾。 */
function clampText(content, maxBytes = WECOM_TEXT_MAX_BYTES) {
    const buffer = Buffer.from(content, 'utf8')
    if (buffer.byteLength <= maxBytes) return content
    // 截断点可能落在多字节字符中间,toString 会用 U+FFFD 占位;去掉末尾占位符才不超上限
    const head = buffer.subarray(0, Math.max(0, maxBytes - 3)).toString('utf8').replace(/\uFFFD+$/, '')
    return `${head}...`
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

/** 截断 + 组包 + 发送:网络失败按指数退避重试,errcode 拒绝立即失败。 */
async function postWecom({ url, text, msgtype = 'text', retries = 2, timeoutMs = WECOM_TIMEOUT_MS, fetchImpl = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onRetry }) {
    const maxBytes = msgtype === 'markdown' ? WECOM_MARKDOWN_MAX_BYTES : WECOM_TEXT_MAX_BYTES
    const content = clampText(text, maxBytes)
    const body = msgtype === 'markdown'
        ? { msgtype: 'markdown', markdown: { content } }
        : { msgtype: 'text', text: { content } }

    let lastError
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await postOnce(url, body, fetchImpl, timeoutMs)
        } catch (error) {
            lastError = error
            if (error instanceof WecomError || attempt === retries) break
            onRetry?.(error, attempt + 1)
            await sleep(1000 * 2 ** attempt)
        }
    }
    throw lastError
}
// <<< wecom-core end

export const TEXT_MAX_BYTES = WECOM_TEXT_MAX_BYTES
export const MARKDOWN_MAX_BYTES = WECOM_MARKDOWN_MAX_BYTES
export const DEFAULT_TIMEOUT_MS = WECOM_TIMEOUT_MS
export { clampText, WecomError }

/**
 * 发送一条消息。
 * @param {string} text 消息内容,超长会自动截断
 * @param {{ webhookUrl: string, msgtype?: 'text'|'markdown', retries?: number,
 *           timeoutMs?: number, fetchImpl?: typeof fetch, sleep?: (ms:number)=>Promise<void>,
 *           onRetry?: (error: Error, attempt: number) => void }} options
 */
export async function sendWecom(text, options = {}) {
    const { webhookUrl, msgtype = 'text', retries, timeoutMs, fetchImpl, sleep, onRetry } = options ?? {}

    if (!webhookUrl) throw new Error('sendWecom 需要 webhookUrl')
    if (!text?.trim()) throw new Error('sendWecom 需要非空文本')

    return postWecom({ url: webhookUrl, text, msgtype, retries, timeoutMs, fetchImpl, sleep, onRetry })
}
