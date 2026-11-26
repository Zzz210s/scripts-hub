// 抓淘宝闪购任务页真正发出的接口:注入已有 cookie(不必再登录)→ 打开 task-list →
// 记录所有 /h5/mtop 与 /restapi 请求(方法、URL、请求体、返回 ret)。零依赖。
//
// 用途:页面版本一改,resId / 参数就变;与其猜,不如让它自己说。
//   set COOKIE_FILE=%TEMP%\shanggou-cookie.txt
//   node scripts/windows/capture-api.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const TEMP = process.env.TEMP || process.env.TMP || os.tmpdir()
const CHROME = process.env.CHROME_PATH || process.env.CHROME || 'chrome'
const PORT = Number(process.env.CDP_PORT || 9334)
const PROFILE = process.env.LOGIN_PROFILE || path.join(TEMP, 'shanggou-login-profile')
const COOKIE_FILE = process.env.COOKIE_FILE || path.join(TEMP, 'shanggou-cookie.txt')
const PAGE = process.env.TARGET || 'https://h5.ele.me/svip/task-list'
const WATCH_MS = Number(process.env.WATCH_MS || 30000)

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
    this.onEvent = () => {}
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      } else if (msg.method) {
        this.onEvent(msg.method, msg.params)
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
      }, 60000)
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

const INTERESTING = process.env.ALL_URLS === '1' ? /./ : /\/h5\/mtop\.|restapi\//
const STATIC = /\.(png|jpe?g|svg|woff2?|css|gif|webp|js)(\?|$)/

async function main() {
  const cookieText = fs.readFileSync(COOKIE_FILE, 'utf8').trim()
  const jar = cookieText.split('; ').map((one) => {
    const eq = one.indexOf('=')
    return { name: one.slice(0, eq), value: one.slice(eq + 1) }
  })
  fs.rmSync(PROFILE, { recursive: true, force: true })

  const chrome = spawn(CHROME, [
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=420,900',
    'about:blank',
  ], { detached: false, stdio: 'ignore' })

  const seen = new Map()
  try {
    const cdp = await connect(await targetUrl())
    await cdp.send('Network.enable')
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    let injected = 0
    for (const one of jar) {
      try {
        await cdp.send('Network.setCookie', { ...one, url: 'https://h5.ele.me', sameSite: 'None', secure: true })
        injected += 1
      } catch { /* 个别 cookie 形状不合规,跳过 */ }
    }
    console.log(`[就绪] 注入 ${injected}/${jar.length} 个 cookie,打开 ${PAGE}`)

    cdp.onEvent = (method, params) => {
      if (method === 'Network.requestWillBeSent') {
        const url = params.request.url
        if (!INTERESTING.test(url)) return
        if (STATIC.test(url)) return
        const id = params.requestId
        const api = /\/h5\/([^/]+)\//.exec(url)?.[1] ?? url.replace('https://h5.ele.me', '').split('?')[0]
        seen.set(id, { api, method: params.request.method, postData: params.request.postData ?? null })
      }
      if (method === 'Network.responseReceived') {
        const one = seen.get(params.requestId)
        if (one) one.status = params.response.status
      }
    }

    await cdp.send('Page.navigate', { url: PAGE })
    await sleep(WATCH_MS)

    // 页面把结果写在 localStorage / window 上时更好读,这里顺手捞一次
    const probe = await cdp.send('Network.getAllCookies').catch(() => ({ cookies: [] }))
    console.log(`[cookie] 仍有效:${probe.cookies.some((c) => c.name === 'SID' && c.value)}`)
  } finally {
    const rows = [...seen.values()]
    console.log(`[捕获] ${rows.length} 个接口`)
    for (const row of rows) {
      console.log(`- ${row.status ?? '?'} ${row.method} ${row.api}`)
      if (row.postData) console.log(`    body: ${String(row.postData).slice(0, 300)}`)
    }
    if (process.env.KEEP_PROFILE === '1') {
      console.log('[保留] profile:' + PROFILE)
    } else {
      try { chrome.kill() } catch { /* 忽略 */ }
    }
  }
  return 0
}

process.exitCode = await main()
