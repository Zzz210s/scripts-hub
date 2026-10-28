// 用真实浏览器登录网易云:开一个独立临时 profile 的 Chrome,打开扫码登录页,截图二维码,
// 然后轮询 CDP 的 getAllCookies 等 MUSIC_U 出现。零依赖:CDP 走 HTTP + 内置 WebSocket。
//
// 为什么走浏览器而不是手抓:网易云的 MUSIC_U 是 HttpOnly,document.cookie 读不到;
// 只有 CDP 的 Network.getAllCookies 能拿到。临时 profile 用完即删,不碰用户日常 profile。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

// 路径全部走环境变量与系统临时目录:这个仓库是公开的,不该出现某台机器的绝对路径
const TEMP = process.env.TEMP || process.env.TMP || os.tmpdir()
const CHROME = process.env.CHROME_PATH
  || process.env.CHROME
  || 'chrome'
const PORT = Number(process.env.CDP_PORT || 9333)
const PROFILE = process.env.LOGIN_PROFILE || path.join(TEMP, 'netease-login-profile')
const SHOT = process.env.SHOT_PATH || path.join(TEMP, 'netease-qr.png')
const WAIT_MS = Number(process.env.WAIT_MS || 240000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function targetUrl() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  throw new Error('CDP 端口没起来')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      }
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} 超时`))
      }, 20000)
    })
  }
}

async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('WS 连接失败')), { once: true })
  })
  return new Cdp(ws)
}

/** 在页面上下文里读二维码图片的 dataURL(登录页是 iframe,得钻进 frame)。 */
async function grabQr(cdp) {
  const { frameTree } = await cdp.send('Page.getFrameTree')
  const frames = []
  const walk = (node) => {
    frames.push(node.frame.id)
    for (const child of node.childFrames ?? []) walk(child)
  }
  walk(frameTree)
  for (const frameId of frames) {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(() => { const img = document.querySelector('img[src^="data:image"]') || document.querySelector('.qrcode img') || document.querySelector('img'); return img ? img.src : '' })()`,
      contextId: undefined,
      returnByValue: true,
    }).catch(() => ({ result: {} }))
    const src = result?.value
    if (typeof src === 'string' && src.startsWith('data:image')) return { frameId, src }
  }
  return null
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true })
  const chrome = spawn(CHROME, [
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    '--window-size=900,900',
    'https://music.163.com/login?targetUrl=https%3A%2F%2Fmusic.163.com%2F',
  ], { detached: false, stdio: 'ignore' })

  try {
    const cdp = await connect(await targetUrl())
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')
    // 登录页默认就是扫码;等它渲染出二维码
    let qr = null
    for (let i = 0; i < 40 && !qr; i += 1) {
      await sleep(500)
      qr = await grabQr(cdp)
    }
    // 窗口是可见的:用户直接在屏幕上扫码。截图只留一份备查。
    if (qr?.src) {
      fs.writeFileSync(SHOT, Buffer.from(qr.src.split(',')[1], 'base64'))
    }
    console.log('[等待扫码] 浏览器窗口已打开,用网易云 App 扫那个二维码(约 5 分钟内有效)')

    const deadline = Date.now() + WAIT_MS
    while (Date.now() < deadline) {
      const { cookies } = await cdp.send('Network.getAllCookies')
      const hit = cookies.find((c) => c.name === 'MUSIC_U' && /163\.com$/.test(c.domain.replace(/^\./, '')))
      if (hit && hit.value && hit.value.length > 20) {
        const out = process.env.COOKIE_OUT || ''
        if (out) fs.writeFileSync(out, `MUSIC_U=${hit.value}\n`, { mode: 0o600 })
        console.log(`[成功] 拿到 MUSIC_U · 长度 ${hit.value.length} · 域名 ${hit.domain}`)
        return 0
      }
      await sleep(2000)
    }
    console.log('[超时] 等不到 MUSIC_U —— 二维码可能过期,重跑本脚本换一张')
    return 1
  } finally {
    try { chrome.kill() } catch { /* 忽略 */ }
    await sleep(500)
    fs.rmSync(PROFILE, { recursive: true, force: true })
  }
}

process.exitCode = await main()
