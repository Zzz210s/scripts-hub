// 企业微信智能机器人 -> 本机 HTTP 通知端点。
//
// 背景:项目原来的通知走群机器人 webhook(wecom-blog.txt 那种 key=...)。
// 现在改成用智能机器人(长连接)主动推送:aibot_send_msg 需要 chatid,
// 而 chatid 只有对方先跟机器人说过话才拿得到 —— 所以本服务先订阅长连接、
// 记住最近的会话,再对外暴露一个和群机器人 webhook 同形状的 POST /webhook。
//
// 于是调用方(e.g. note-app 的 NOTIFY_WEBHOOK)只改 URL,不用改代码:
//   NOTIFY_WEBHOOK=http://127.0.0.1:9099/webhook
//
// 只监听 127.0.0.1(见 BIND),不对外开口子。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { WSClient } from '@wecom/aibot-node-sdk'

const BIND = process.env.BIND ?? '127.0.0.1'
const PORT = Number(process.env.PORT ?? 9099)
const CHATS_FILE = process.env.CHATS_FILE ?? path.join(process.env.DATA_DIR ?? './data', 'chats.json')
const TOKEN = process.env.RELAY_TOKEN ?? ''
const log = (m) => process.stdout.write(`[relay] ${new Date().toISOString()} ${m}\n`)

/** 读 botId/secret:优先 SECRETS_FILE(600 的 JSON),其次环境变量。 */
function readCredentials() {
    const file = process.env.SECRETS_FILE
    if (file) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (!raw.botId || !raw.secret) throw new Error(`${file} 缺少 botId/secret`)
        return { botId: String(raw.botId), secret: String(raw.secret) }
    }
    if (process.env.BOT_ID && process.env.BOT_SECRET) {
        return { botId: process.env.BOT_ID, secret: process.env.BOT_SECRET }
    }
    throw new Error('没有凭据:请给 SECRETS_FILE,或 BOT_ID + BOT_SECRET')
}

/** 已记住的会话:chatKey -> { chatKey, userId, lastSeen } */
function loadChats() {
    try {
        return JSON.parse(fs.readFileSync(CHATS_FILE, 'utf8'))
    } catch {
        return {}
    }
}

function saveChats(chats) {
    fs.mkdirSync(path.dirname(CHATS_FILE), { recursive: true })
    const tmp = `${CHATS_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(chats, null, 2), 'utf8')
    fs.renameSync(tmp, CHATS_FILE)
}

/** 群里用 chatid,单聊用 userid —— 与 aibot 回调里的形状保持一致。 */
function chatKeyOf(body) {
    if (body?.chattype === 'group') return body?.chatid ? String(body.chatid) : ''
    return String(body?.from?.userid ?? '')
}

const chats = loadChats()
const credentials = readCredentials()
const client = new WSClient({
    botId: credentials.botId,
    secret: credentials.secret,
    logger: { debug() {}, info() {}, warn: (m) => log(`SDK warn: ${m}`), error: (m) => log(`SDK error: ${m}`) }
})

const MESSAGE_EVENTS = ['message.text', 'message.voice', 'message.image', 'message.file', 'message.mixed', 'message.video']

function remember(body, source) {
    const chatKey = chatKeyOf(body)
    if (!chatKey) return
    chats[chatKey] = { chatKey, userId: String(body?.from?.userid ?? ''), lastSeen: new Date().toISOString(), source }
    saveChats(chats)
    log(`记住会话 ${chatKey}(共 ${Object.keys(chats).length} 个)`)
}

for (const event of MESSAGE_EVENTS) {
    client.on(event, (frame) => {
        remember(frame?.body, event)
        // 收到消息时回一句,让对方知道通道是通的;失败不影响记住会话
        const chatKey = chatKeyOf(frame?.body)
        if (chatKey) {
            client.sendMessage(chatKey, { msgtype: 'text', text: { content: '通知通道已就绪,后续博客与同步告警会推到这里。' } })
                .catch((e) => log(`回执失败: ${String(e)}`))
        }
    })
}
client.on('event.enter_chat', (frame) => remember(frame?.body, 'enter_chat'))
client.on('authenticated', () => log('长连接认证成功'))
client.on('error', (e) => log(`长连接错误: ${e?.name ?? ''} ${e?.message ?? String(e)}`))
client.on('event.disconnected_event', () => log('被服务端断开(可能别处登录了同一机器人)'))

/** 推给所有记住的会话;没有会话就报 503,让调用方的日志能看出是"还没人跟机器人说过话"。 */
async function push(text) {
    const targets = Object.keys(chats)
    if (targets.length === 0) return { ok: false, code: 503, message: '还没有可用会话:请先给机器人发一条消息' }
    const failures = []
    for (const chatKey of targets) {
        try {
            await client.sendMessage(chatKey, { msgtype: 'text', text: { content: text } })
        } catch (error) {
            failures.push(`${chatKey}: ${String(error)}`)
        }
    }
    if (failures.length === targets.length) return { ok: false, code: 502, message: failures.join('; ') }
    return { ok: true, code: 200, message: failures.length ? `部分失败: ${failures.join('; ')}` : 'ok' }
}

/** SDK 的 `isConnected` 是 getter(不是方法);包一层避免取值本身抛错把请求打挂。 */
function isConnected() {
    try {
        return Boolean(client.isConnected)
    } catch {
        return false
    }
}

const server = http.createServer((req, res) => {
    const reply = (code, payload) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(payload))
    }
    try {
        handle(req, res, reply)
    } catch (error) {
        // 单个请求处理出错不能把整个中继带走(2026-10-25:isConnected 被当方法调用,把进程崩了)
        log(`请求处理异常: ${String(error)}`)
        if (!res.headersSent) reply(500, { errcode: 500, errmsg: '中继内部错误' })
        else res.end()
    }
})

function handle(req, res, reply) {
    if (TOKEN && req.headers['x-relay-token'] !== TOKEN) return reply(401, { errcode: 401, errmsg: 'token 不对' })
    if (req.method === 'GET' && req.url === '/health') {
        return reply(200, { ok: true, connected: isConnected(), chats: Object.keys(chats).length })
    }
    if (req.method !== 'POST') return reply(405, { errcode: 405, errmsg: '只支持 POST' })

    let body = ''
    req.on('data', (chunk) => {
        body += chunk
        if (body.length > 1_000_000) req.destroy()
    })
    req.on('end', async () => {
        let text = ''
        try {
            const parsed = body ? JSON.parse(body) : {}
            // 兼容两种形态:群机器人 webhook 的 {msgtype,text:{content}} 与简化的 {text:"..."}
            text = parsed.text?.content ?? parsed.markdown?.content ?? parsed.text ?? parsed.message ?? ''
        } catch {
            return reply(400, { errcode: 400, errmsg: '正文不是 JSON' })
        }
        if (!text) return reply(400, { errcode: 400, errmsg: '没有正文(text.content 或 text)' })
        const result = await push(String(text))
        log(`${result.ok ? '已推送' : '推送失败'}: ${result.message}`)
        // 兼容调用方对群机器人返回值的判断:成功回 errcode=0
        return reply(result.ok ? 200 : result.code, result.ok
            ? { errcode: 0, errmsg: result.message }
            : { errcode: result.code, errmsg: result.message })
    })
}

server.listen(PORT, BIND, () => log(`HTTP 端点就绪 http://${BIND}:${PORT} (POST /webhook 或 /send,GET /health)`))
client.connect()
