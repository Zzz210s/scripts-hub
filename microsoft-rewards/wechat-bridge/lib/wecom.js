// WeCom (企业微信) group-robot webhook sender. Tencent-hosted, no session
// window and no message cap, which is why it is the primary channel for
// unattended notifications (iLink bots can only reply inside a 24h window).
import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from './store.js'

const WEBHOOK_FILE = path.join(DATA_DIR, 'wecom-webhook.txt')
const MAX_BYTES = 2048

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

function clamp(content) {
    if (Buffer.byteLength(content, 'utf8') <= MAX_BYTES) return content
    const head = Buffer.from(content, 'utf8').subarray(0, MAX_BYTES - 3).toString('utf8')
    return `${head}...`
}

/** Send one text message. Throws with the server's errcode when it fails. */
export async function sendWecom(text) {
    const url = webhookUrl()
    if (!url) throw new Error('未配置企业微信机器人 webhook')

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: clamp(text) } })
    })

    const body = await res.text()
    let parsed
    try {
        parsed = JSON.parse(body)
    } catch {
        parsed = null
    }

    if (!res.ok || (parsed && parsed.errcode !== 0)) {
        const errcode = parsed?.errcode ?? res.status
        const errmsg = parsed?.errmsg ?? body.slice(0, 120)
        throw new Error(`企业微信返回 errcode=${errcode} errmsg=${errmsg}`)
    }

    return true
}
