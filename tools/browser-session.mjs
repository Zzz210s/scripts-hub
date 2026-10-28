// 附到已经在跑的 Chrome(CDP 端口)上操作真实浏览器会话:截图、读页面文本、轮询 MUSIC_U。
// 零依赖:CDP 走 HTTP 取 target,再用内置 WebSocket 说协议。
//
// 用法:
//   node tools/browser-session.mjs shot <out.png>          # 截一张当前页面
//   node tools/browser-session.mjs text                    # 打印页面标题与可见文本
//   node tools/browser-session.mjs wait-cookie <out.txt> [毫秒]   # 轮询 MUSIC_U,拿到就写文件
const PORT = Number(process.env.CDP_PORT || 9333)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function pageTarget() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((item) => item.type === 'page' && /music\.163\.com/.test(item.url))
    ?? list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
  if (!page) throw new Error('没有可用的页面 target')
  return page
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (!msg.id || !this.pending.has(msg.id)) return
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} 超时`)) }, 20000)
    })
  }
}

async function connect() {
  const target = await pageTarget()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('WS 连接失败')), { once: true })
  })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Network.enable')
  return { cdp, target }
}

import os from 'node:os'
import path from 'node:path'

const TEMP = process.env.TEMP || process.env.TMP || os.tmpdir()
const [, , command, arg1, arg2] = process.argv

if (command === 'shot') {
  const { cdp, target } = await connect()
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = arg1 || path.join(TEMP, 'page.png')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`已截图:${out} · 页面:${target.title} · ${target.url}`)
} else if (command === 'text') {
  const { cdp, target } = await connect()
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: 'document.body ? document.body.innerText.slice(0, 1200) : ""',
    returnByValue: true,
  })
  console.log(`页面:${target.title} · ${target.url}`)
  console.log(String(result?.value ?? '').trim())
} else if (command === 'wait-cookie') {
  const out = arg1 || path.join(TEMP, 'music_cookie.txt')
  const limit = Number(arg2 || 300000)
  const { cdp } = await connect()
  const { writeFileSync } = await import('node:fs')
  const deadline = Date.now() + limit
  let seen = 0
  while (Date.now() < deadline) {
    const { cookies } = await cdp.send('Network.getAllCookies')
    const hit = cookies.find((c) => c.name === 'MUSIC_U' && /163\.com$/.test(c.domain.replace(/^\./, '')))
    if (hit?.value && hit.value.length > 20) {
      writeFileSync(out, `MUSIC_U=${hit.value}\n`, { mode: 0o600 })
      console.log(`[成功] 拿到 MUSIC_U · 长度 ${hit.value.length} · 域名 ${hit.domain} · 已写 ${out}`)
      process.exit(0)
    }
    seen += 1
    if (seen % 10 === 0) console.log(`[等待] 还没扫到 · 已等 ${Math.round((limit - (deadline - Date.now())) / 1000)} 秒`)
    await sleep(2000)
  }
  console.error('[超时] 等不到 MUSIC_U —— 二维码可能过期,刷新页面重扫')
  process.exit(1)
} else {
  console.error('用法: browser-session.mjs shot|text|wait-cookie ...')
  process.exit(2)
}
