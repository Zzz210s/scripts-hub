// 端到端自检:用 CDP 驱动一个无头 Chrome 真点一遍面板(保存 / 刷新后打开)。
//
// 前置:
//   1. ssh -f -N -L 8082:127.0.0.1:8082 <服务器>      # 把 8082 隧道到本机
//   2. chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/exc about:blank
//   3. EXC_TOKEN=$(ssh <服务器> 'sudo cat /srv/apps/excalidraw/token.txt') node e2e.mjs
//
// 只用 Node 内置的 WebSocket(Node 22+),不装依赖。
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

/** 连 CDP,提供 evaluate()。 */
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

await send('Page.navigate', { url: APP })
await sleep(6000)
await evaluate(`localStorage.setItem('exc-server-token', ${JSON.stringify(TOKEN)})`)
await send('Page.navigate', { url: APP })
await sleep(6000)

check('页面加载', (await evaluate('document.title')).includes('Excalidraw'))
check(
  '面板按钮存在',
  await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('服务器存储'))`),
)

await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('服务器存储')).click()`)
await sleep(2500)
check('面板可打开', await evaluate(`document.body.innerText.includes('保存到服务器')`))

// 先经 API 写一张带标记的场景,后面验证"打开"是不是真的载入编辑器
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

// 保存:填名字 -> 点保存
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
check(
  '保存成功提示',
  /已保存到服务器/.test(await evaluate(`document.body.innerText`)),
  await evaluate(`(document.body.innerText.match(/已保存到服务器:[^\\n]+/) || [''])[0]`),
)

// 刷新后切到"打开"模式,点标记文件,验证内容进了编辑器
await send('Page.navigate', { url: APP })
await sleep(6000)
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
  await evaluate(`(() => { const v = localStorage.getItem('excalidraw') || ''; return v.includes(${JSON.stringify(MARKER)}); })()`),
)

ws.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n汇总:${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
