// 企业微信群机器人推送:脱敏 + 与其它项目逐字节一致的 wecom-core 发送核心。
//
// 本项目的 notify 层是第四份实现。块内自带的那行说明只列了最初的两份实现
// (proj-microsoft-rewards/wechat-bridge/lib/wecom.js 与 proj-weread-signin/src/notify.js),
// 那两处是生成快照、不能在这里改;更正说明只能像 proj-epic-free-games/src/notify.js 那样写在块外。
// 要改共享核心,先改 docs/wecom-rules.md,再把块整段同步到四处(含两份快照的权威工作区),
// 最后跑 scripts/check-wecom-drift.mjs。
import fs from 'node:fs'
// >>> wecom-core begin —— 企业微信发送实现的共同核心,改一处必须同步其余各处
// 本块在 proj-microsoft-rewards/wechat-bridge/lib/wecom.js 与 proj-weread-signin/src/notify.js
// 中逐字节一致,由 scripts/check-wecom-drift.mjs 校验;共享规则见 docs/wecom-rules.md。
const WECOM_TEXT_MAX_BYTES = 2048
const WECOM_MARKDOWN_MAX_BYTES = 4096
const WECOM_TIMEOUT_MS = 10000
// 只有限流(45009)值得退避重试;其余 errcode 是服务端拒绝,重试没有意义。
const WECOM_RETRYABLE_ERRCODES = new Set([45009])

/** 企业微信返回的 errcode 错误;errcode 供调用方区分限流与配置类失败。 */
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

/** 截断 + 组包 + 发送:网络失败与限流按指数退避重试,其余 errcode 拒绝立即失败。 */
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
            if ((error instanceof WecomError && !WECOM_RETRYABLE_ERRCODES.has(error.errcode)) || attempt === retries) break
            onRetry?.(error, attempt + 1)
            await sleep(1000 * 2 ** attempt)
        }
    }
    throw lastError
}
// <<< wecom-core end

export function maskSecret(text) {
    return String(text)
        .replace(/(key=)[A-Za-z0-9-]{6,}/g, '$1****')
        .replace(/(EG_PASSWORD=)[^\s'"]+/gi, '$1****')
        .replace(/(password["']?\s*[:=]\s*["']?)[^"'\s]+/gi, '$1****')
}

export const truncateText = (text, limitBytes = 2048) => clampText(text, limitBytes)

export function loadWebhook(file) {
    if (!file || !fs.existsSync(file)) return ''
    return fs.readFileSync(file, 'utf8').trim()
}

/** 发送一条文本;失败返回 { ok:false, error } 而不抛,调用方只看返回值。 */
export async function sendWecom(text, options = {}) {
    const webhook = options.webhook ?? loadWebhook(options.webhookFile)
    if (options.dryRun) return { ok: true, note: 'dry-run 未发送' }
    if (!webhook) return { ok: false, error: '未配置企业微信 webhook' }
    try {
        await postWecom({
            url: webhook,
            text: maskSecret(text),
            fetchImpl: options.fetchImpl,
            sleep: options.sleep,
            retries: options.retries,
            timeoutMs: options.timeoutMs,
            onRetry: options.onRetry
        })
        return { ok: true }
    } catch (error) {
        return { ok: false, error: error?.message ?? String(error), errcode: error?.errcode }
    }
}
