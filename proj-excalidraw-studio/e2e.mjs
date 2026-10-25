// 端到端自检:用 CDP 驱动无头 Chrome 真点一遍(保存到服务器 / 刷新后打开 / 本地保存)。
//
// 前置:
//   ssh -f -N -L 8082:127.0.0.1:8082 <服务器>
//   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/exc about:blank
//   EXC_TOKEN=$(ssh <服务器> 'sudo cat /srv/apps/excalidraw/token.txt') node e2e.mjs
//
// 只用 Node 22+ 内置 WebSocket,不装依赖。
const CDP = process.env.CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.APP ?? 'http://127.0.0.1:8082/'
const TOKEN = process.env.EXC_TOKEN
const NAME = process.env.EXC_NAME ?? 'e2e-自检'
const MARKER = `E2E-标记-${Date.now()}`

if (!TOKEN) {
  console.error('缺少 EXC_TOKEN(服务器上 /srv/apps/excalidraw/token.txt)')
  process.exit(2)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function attach() {
  const targets = await (await fetch(`${CDP}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('没有可用的页面目标')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const callId = ++id
      pending.set(callId, resolve)
      ws.send(JSON.stringify({ id: callId, method, params }))
    })
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 300))
    return res.result?.result?.value
  }
  await send('Page.enable')
  await send('Runtime.enable')
  return { ws, send, evaluate }
}

const results = []
const check = (label, ok, extra = '') => {
  results.push({ label, ok })
  console.log(`[${ok ? 'OK  ' : 'FAIL'}] ${label}${extra ? ' —— ' + extra : ''}`)
}

const { ws, send, evaluate } = await attach()

// 先清掉站点数据:旧前端(官方 app)注册过 Service Worker,不清会继续把旧页面喂给浏览器
try {
  await send('Storage.clearDataForOrigin', { origin: new URL(APP).origin, storageTypes: 'all' })
} catch {
  // 老版本 CDP 没有这个命令时忽略
}
await send('Page.navigate', { url: APP })
await sleep(8000)
await evaluate(`localStorage.setItem('exc-server-token', ${JSON.stringify(TOKEN)})`)
await send('Page.navigate', { url: APP })
await sleep(7000)

check(
  '页面是自建薄壳',
  await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '保存到本地')`),
  await evaluate('[...document.scripts].map((s) => s.src).filter(Boolean).join(",")'),
)
check('画布已渲染', (await evaluate(`document.querySelectorAll('canvas').length`)) >= 1)
check(
  '存储面板按钮存在',
  await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('服务器存储'))`),
)

await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('服务器存储')).click()`)
await sleep(2500)
check('面板可打开', await evaluate(`document.body.innerText.includes('保存到服务器')`))

// 先用 API 写一张带标记的场景,后面验证"打开"是否真的载入
const scene = {
  type: 'excalidraw',
  version: 2,
  source: 'e2e',
  elements: [
    {
      id: 'e2e-text', type: 'text', x: 40, y: 40, width: 220, height: 30, angle: 0,
      strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
      strokeWidth: 1, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null,
      roundness: null, boundElements: [], updated: Date.now(), link: null, locked: false,
      text: MARKER, fontSize: 20, fontFamily: 1, textAlign: 'left', verticalAlign: 'top',
      baseline: 18, containerId: null, originalText: MARKER, lineHeight: 1.25,
      seed: 1, version: 1, versionNonce: 1, isDeleted: false,
    },
  ],
  files: {},
  appState: { viewBackgroundColor: '#ffffff', gridSize: null },
}
const put = await fetch(`${APP}api/scene?path=${encodeURIComponent('e2e-标记.excalidraw')}`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify({ scene }),
})
check('API 写入标记场景', put.status === 200, `HTTP ${put.status}`)

const typed = await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('文件名'));
  if (!input) return 'no-input';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(NAME)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input.value;
})()`)
check('文件名可填', typed === NAME, String(typed))

await evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === '保存').at(-1).click()`)
await sleep(3000)
const statusText = await evaluate(`document.body.innerText`)
check('保存成功提示', /已保存到服务器/.test(statusText), (statusText.match(/已保存到服务器:[^\n]+/) || [''])[0])

// 刷新后切"打开"模式,点标记文件,验证内容进编辑器
await send('Page.navigate', { url: APP })
await sleep(7000)
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('服务器存储')).click()`)
await sleep(2500)
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '改为打开').click()`)
await sleep(1500)
await evaluate(`(() => {
  const rows = [...document.querySelectorAll('div')].filter((d) => /^e2e-标记\\.excalidraw/.test(d.textContent.trim()));
  if (rows.length) rows[rows.length - 1].click();
  return rows.length;
})()`)
await sleep(4000)
check('打开后面板自动关闭', await evaluate(`!document.body.innerText.includes('从服务器打开')`))
check(
  '打开的内容进入编辑器',
  await evaluate(`(() => { const v = localStorage.getItem('studio-scene') || ''; return v.includes(${JSON.stringify(MARKER)}); })()`),
)

// 本地保存:HTTP(非安全上下文)下应明确告知"下载到下载目录,HTTPS 后可选文件夹"
check(
  '本地保存按钮存在',
  await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '保存到本地')`),
)
const secure = await evaluate('window.isSecureContext')
check(
  '文件选择器可用性与安全上下文一致',
  (await evaluate(`'showSaveFilePicker' in window`)) === secure,
  secure ? '当前是安全上下文(localhost/HTTPS):可以选文件夹' : '当前是 http://IP:端口:退回下载,换 HTTPS 后可选文件夹',
)

ws.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n汇总:${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
