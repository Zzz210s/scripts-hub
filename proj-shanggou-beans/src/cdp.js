// CDP 薄封装:起 Chrome / 连上现有实例 / 发命令。零依赖,只用 Node 内置 WebSocket。
// 与 tools/netease-qr-login.mjs 同源,多了 launch 与事件订阅(页面要抓 XHR 与点击结果)。
import { spawn } from 'node:child_process'
import os from 'node:os'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const chromePath = () =>
  process.env.SHANGGOU_CHROME ||
  process.env.CHROME_PATH ||
  process.env.CHROME ||
  (process.platform === 'win32'
    ? `${process.env.ProgramFiles || process.env['ProgramFiles(x86)'] || ''}/Google/Chrome/Application/chrome.exe`
    : 'chromium')

export class Cdp {
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

/** 连 CDP 的 page endpoint;/json/list 里挑第一个页面目标。 */
export async function attach(port) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((one) => one.type === 'page' && one.webSocketDebuggerUrl)
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true })
          ws.addEventListener('error', () => reject(new Error('WS 连接失败')), { once: true })
        })
        return new Cdp(ws)
      }
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  throw new Error('CDP 端口没起来')
}

/**
 * 起一个独立 profile 的 Chrome 并连上。headless 只是给服务器上的验证用,
 * 常规路径用有头模式:淘宝系的指纹判断更信有头(见 ai-order-takeout 的踩坑记录)。
 */
export async function launch({ port = 9350, profile, headless = false, size = [430, 900] } = {}) {
  const dir = profile || `${os.tmpdir()}/shanggou-profile-${port}`
  const args = [
    `--user-data-dir=${dir}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    `--window-size=${size[0] + 40},${size[1] + 120}`,
    ...(headless ? ['--headless=new'] : []),
    // 容器里以 root 跑必须 --no-sandbox;这些参数只该由部署侧给,不写死在代码里。
    ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(/\s+/).filter(Boolean) : []),
    'about:blank',
  ]
  const chrome = spawn(chromePath(), args, { stdio: 'ignore' })
  const cdp = await attach(port)
  return { cdp, chrome, dir }
}

/**
 * 把一行 cookie 串灌进浏览器。必须按**域**灌(domain=.ele.me / .taobao.com),
 * 只按 url=https://h5.ele.me 灌的话,页面自己能用,但它发给 waimai-guide.ele.me 的
 * mtop 请求带不上这些 cookie —— 实测页面会显示「未登录去登录」。
 */
export async function injectCookies(cdp, cookieText, domains = ['.ele.me', '.taobao.com']) {
  const jar = cookieText.split('; ').map((one) => {
    const eq = one.indexOf('=')
    return { name: one.slice(0, eq).trim(), value: one.slice(eq + 1).trim() }
  }).filter((one) => one.name && one.value)
  let ok = 0
  // 不写 expires 的 cookie 是**会话 cookie**,只活在内里、关浏览器就没了 —— 我们导出的 jar 没有
  // 过期时间,所以这里必须补 30 天,否则 seed 完了下一轮 profile 仍是「未登录」。
  const expires = Math.floor(Date.now() / 1000) + 30 * 86400
  for (const one of jar) {
    for (const domain of domains) {
      try {
        await cdp.send('Network.setCookie', { ...one, domain, path: '/', secure: true, sameSite: 'None', expires })
        ok += 1
      } catch { /* 形状不合规的跳过 */ }
    }
  }
  return { injected: ok, total: jar.length * domains.length }
}

/** 手机端仿真四件套:UA / 视口+触屏 / 时区 / 语言。少一样都和页面实际看到的不一致。 */
export async function emulateMobile(cdp, { longitude, latitude } = {}) {
  const ua = 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: ua, platform: 'Android', acceptLanguage: 'zh-CN,zh' })
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 430, height: 900, deviceScaleFactor: 2.6, mobile: true,
    screenOrientation: { type: 'portraitPrimary', angle: 0 },
  })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' })
  if (typeof longitude === 'number' && typeof latitude === 'number') {
    // 光设坐标不够:页面要 navigator.geolocation 的权限,denied 时它会显示「无法获取位置信息」。
    try {
      await cdp.send('Browser.grantPermissions', { origin: 'https://h5.ele.me', permissions: ['geolocation'] })
    } catch { /* 老版本 Chrome 不支持就交给 setGeolocationOverride */ }
    await cdp.send('Emulation.setGeolocationOverride', { longitude, latitude, accuracy: 30 })
  }
}

/** 优雅关闭:Browser.close 让 Chrome 把 cookie 落盘。硬 kill 会丢 cookie —— 实测下一轮
 * profile 里还是「未登录」,这也是首次 seed 后必须优雅退出的原因。 */
export async function shutdown(cdp, chrome, { timeoutMs = 8000 } = {}) {
  try { await cdp.send('Browser.close') } catch { /* 已经关了 */ }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (chrome?.exitCode !== null && chrome?.exitCode !== undefined) return
    await sleep(200)
  }
  try { chrome.kill() } catch { /* 只能硬杀 */ }
}

/** 在页面里跑一段表达式,返回值(抛错时返回 {error})。 */
export async function evaluate(cdp, expression) {
  const { result } = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  })
  return result?.value
}
