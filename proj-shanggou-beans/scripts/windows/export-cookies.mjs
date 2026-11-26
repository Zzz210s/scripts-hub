// 用真实浏览器登录淘宝闪购(h5.ele.me),把 ele.me 与 taobao.com 两边的 cookie 导成一行。
// 零依赖:CDP 走 HTTP + 内置 WebSocket。改自 tools/netease-qr-login.mjs(同一种问题:凭据是
// HttpOnly,document.cookie 读不到,只有 Network.getAllCookies 能拿)。
//
// 用法(Windows,Node 22+):
//   set COOKIE_OUT=%TEMP%\shanggou-cookie.txt
//   node scripts/windows/export-cookies.mjs
// 自己弹一个独立临时 profile 的 Chrome,你扫码或短信登录,脚本轮询到 SID 就落盘并关窗。
// 不碰你日常浏览器的 profile;cookie 文件权限 600,不要提交、不要贴进聊天。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const TEMP = process.env.TEMP || process.env.TMP || os.tmpdir()
const CHROME = process.env.CHROME_PATH || process.env.CHROME || 'chrome'
const PORT = Number(process.env.CDP_PORT || 9333)
const PROFILE = process.env.LOGIN_PROFILE || path.join(TEMP, 'shanggou-login-profile')
const WAIT_MS = Number(process.env.WAIT_MS || 1800000)
const OUT = process.env.COOKIE_OUT || path.join(TEMP, 'shanggou-cookie.txt')
const LOGIN_URL = 'https://h5.ele.me/login/'

// 只收这两棵域:restapi 在 h5.ele.me,mtop 网关在 *.m.taobao.com,两边都要。
const IN_DOMAIN = (domain) => /(^|\.)(ele\.me|taobao\.com)$/.test(String(domain || '').replace(/^\./, ''))

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

/** 合并两边 cookie 成一行。同名键以 ele.me 的为准 —— 那才是接口认的那份。 */
function mergeJar(cookies) {
  const byName = new Map()
  for (const one of cookies.filter((c) => IN_DOMAIN(c.domain) && c.value)) {
    const host = String(one.domain).replace(/^\./, '')
    const preferEleme = /ele\.me$/.test(host)
    const previous = byName.get(one.name)
    if (!previous || preferEleme || !previous.preferEleme) {
      byName.set(one.name, { name: one.name, value: one.value, preferEleme })
    }
  }
  return [...byName.values()].map((one) => `${one.name}=${one.value}`).join('; ')
}

async function main() {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { /* Chrome 还在退出,换新目录 */ }
  const chrome = spawn(CHROME, [
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    '--window-size=520,900',
    ...(process.env.HEADLESS === '1' ? ['--headless=new'] : []),
    LOGIN_URL,
  ], { detached: false, stdio: 'ignore' })

  try {
    const cdp = await connect(await targetUrl())
    await cdp.send('Network.enable')
    await cdp.send('Page.enable')
    console.log('[等待登录] 窗口已打开,扫码或用手机号验证码登录一次(不给密码)')

    const deadline = Date.now() + WAIT_MS
    while (Date.now() < deadline) {
      let cookies = []
      try {
        ;({ cookies } = await cdp.send('Network.getAllCookies'))
      } catch {
        await sleep(2000)
        continue
      }
      const sid = cookies.find((c) => c.name === 'SID' && /ele\.me$/.test(String(c.domain).replace(/^\./, '')))
      if (sid && sid.value && sid.value.length > 20) {
        const jar = mergeJar(cookies)
        const names = jar.split('; ').map((one) => one.split('=')[0])
        fs.writeFileSync(OUT, jar + String.fromCharCode(10), { mode: 0o600 })
        console.log(`[成功] ${names.length} 个 cookie 已落盘 · ${OUT}`)
        console.log('[成功] 键:' + names.join(','))
        // 值一律只报长度,绝不打印原文
        for (const key of ['SID', 'cookie2', 'USERID', 'unb', '_m_h5_tk', '_m_h5_tk_enc']) {
          const one = names.includes(key) ? jar.split('; ').find((s) => s.startsWith(key + '=')) : null
          console.log(`  ${key}: ${one ? one.length - key.length - 1 + ' 字符' : '缺'}`)
        }
        return 0
      }
      await sleep(2000)
    }
    console.log('[超时] 没等到 SID —— 登录没完成或窗口被关了,重跑本脚本')
    return 1
  } finally {
    if (process.env.KEEP_PROFILE === '1') {
      console.log('[保留] profile:' + PROFILE)
    } else {
      try { chrome.kill() } catch { /* 忽略 */ }
      await sleep(500)
      try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { /* 系统回收 */ }
    }
  }
}

process.exitCode = await main()
