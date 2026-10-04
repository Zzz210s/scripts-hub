// WeCom (企业微信) group-robot webhook sender. Tencent-hosted, no session
// window and no message cap, which is why it is the primary channel for
// unattended notifications (iLink bots can only reply inside a 24h window).
import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from './store.js'

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

const WEBHOOK_FILE = path.join(DATA_DIR, 'wecom-webhook.txt')

/** Webhook URL from WECOM_WEBHOOK_URL or the local file, or null when unset. */
export function webhookUrl() {
    const fromEnv = process.env.WECOM_WEBHOOK_URL?.trim()
    if (fromEnv) return fromEnv

    try {
        const raw = fs.readFileSync(WEBHOOK_FILE, 'utf8').trim()
        if (!raw || raw.startsWith('#')) return null
        return raw
    } catch {
        return null
    }
}

export function isConfigured() {
    return Boolean(webhookUrl())
}

/**
 * Send one text message. Throws with the server's errcode when it fails.
 * Production entry point: the only override is the webhook URL (normally from
 * WECOM_WEBHOOK_URL or the local file). Transport dependencies (fetch, backoff,
 * timeout) are fixed to the production defaults and are not part of this API.
 */
export async function sendWecom(text, { url } = {}) {
    return deliver(text, { url })
}

/**
 * Test-only hook. The __ prefix marks it as internal: it injects
 * fetchImpl / sleep / retries / timeoutMs / onRetry to exercise the backoff
 * rules. Production traffic does not go through it, and both paths share the
 * single implementation below, so behaviour is identical.
 */
export function __deliverWecom(text, transport = {}) {
    return deliver(text, transport)
}

/** Shared send implementation; postWecom fills in the production defaults. */
async function deliver(text, { url, fetchImpl, sleep, retries, timeoutMs, onRetry } = {}) {
    const target = url ?? webhookUrl()
    if (!target) throw new Error('未配置企业微信机器人 webhook')

    await postWecom({ url: target, text, fetchImpl, sleep, retries, timeoutMs, onRetry })
    return true
}
