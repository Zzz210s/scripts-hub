// 在真实页面里读任务、点「领取」。这一层不碰 mtop:页面自己的 SDK 带 umid 与指纹,
// 我们只负责把按钮按下去 —— 纯 HTTP 领取被风控(100012 风控用户)时,这是唯一不逆向的路。
import fs from 'node:fs'
import path from 'node:path'
import { evaluate, injectCookies, sleep } from './cdp.js'

export const TASK_PAGE = 'https://h5.ele.me/svip/task-list'

// 页面文案一旦出现这些词,说明风控要人。此时必须停手:硬蒙等于自证机器。
export const CAPTCHA_WORDS = /请选择符合描述|安全验证|滑动验证|拖动滑块|人机验证|请完成验证|向右滑动|依次点击|验证码/i

/** 读页面上所有「按钮可能就是领取」的候选:文案、可见性、坐标。 */
const LIST_BUTTONS = `(() => {
  const out = [];
  const nodes = document.querySelectorAll('button, div, span, a');
  for (const node of nodes) {
    const text = (node.innerText || '').trim();
    if (!/^(领取|立即领取|去领取|签到|立即签到|收下)$/.test(text)) continue;
    const r = node.getBoundingClientRect();
    if (r.width < 20 || r.height < 12) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.5) continue;
    out.push({ text, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) });
  }
  return out;
})()`

/** 页面可读文本,给日志与判定用(html2text 的糙版:去掉脚本样式)。 */
const PAGE_TEXT = `(() => {
  const clone = document.body ? document.body.cloneNode(true) : null;
  if (!clone) return '';
  for (const bad of clone.querySelectorAll('script,style,svg')) bad.remove();
  return (clone.innerText || '').replace(/\\n{2,}/g, '\\n').trim().slice(0, 1500);
})()`

/** 同源读豆数:不用把 cookie 导出到磁盘,页面自己带着会话。 */
const PEA = `(async () => {
  const r = await fetch('/restapi/biz.svip_core/v1/foodie/homepage?longitude=' + (window.__lng || 116.4074) + '&latitude=' + (window.__lat || 39.9042), { credentials: 'include' });
  const j = await r.json();
  return j?.foodiePeaBlock?.pea ?? null;
})()`

export const readText = (cdp) => evaluate(cdp, PAGE_TEXT)
export const readPea = (cdp) => evaluate(cdp, PEA)
export const listButtons = (cdp) => evaluate(cdp, LIST_BUTTONS)

/** 真鼠标点:CDP 的输入事件走浏览器内核,element.click() 不算数(见 ai-order-takeout 坑六)。 */
export async function clickAt(cdp, x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
}

export async function screenshot(cdp, file) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  return file
}

/** 等人味儿:1.5~4.2 秒,别连点。 */
export const humanPause = () => sleep(1500 + Math.random() * 2700)

/**
 * 跑一轮:进页面 → 读文本 → 逐个点「领取」→ 每点一次核对豆数。
 * 一旦出现验证词就停,把控制权交回人。
 */
export async function claimInPage(cdp, { log, maxClicks = 10, onShot, cookieText } = {}) {
  const events = []
  const note = (event) => { events.push(event); if (log) log(event) }

  await cdp.send('Page.navigate', { url: TASK_PAGE })
  await sleep(6000)

  let text = await readText(cdp)
  // profile 里的登录态没落盘(硬杀浏览器会造成这个)时,拿 cookie 文件补一次,不直接判失败。
  if (cookieText && /未登录|去登录/.test(text)) {
    const { injected, total } = await injectCookies(cdp, cookieText)
    note({ event: 'inject-retry', injected, total })
    await cdp.send('Page.reload', { ignoreCache: false })
    await sleep(6000)
    text = await readText(cdp)
  }
  if (CAPTCHA_WORDS.test(text)) {
    note({ event: 'captcha', phase: 'load', hint: text.match(CAPTCHA_WORDS)?.[0] })
    return { ok: false, reason: 'captcha', events, text }
  }
  const before = await readPea(cdp)
  note({ event: 'pea', when: 'before', value: before })

  if (!/吃货豆|任务|领取|签到/.test(text) || /未登录|去登录/.test(text)) {
    note({ event: 'no-content', text: text.slice(0, 300) })
    return { ok: false, reason: /未登录|去登录/.test(text) ? 'not-logged-in' : 'no-content', events, text }
  }

  let clicked = 0
  for (let round = 0; round < maxClicks; round += 1) {
    const buttons = (await listButtons(cdp)) ?? []
    if (!buttons.length) { note({ event: 'no-buttons', round }); break }
    const target = buttons[0]
    note({ event: 'click', round, text: target.text, x: target.x, y: target.y })
    await clickAt(cdp, target.x, target.y)
    clicked += 1
    await humanPause()

    const after = await readText(cdp)
    if (CAPTCHA_WORDS.test(after)) {
      note({ event: 'captcha', phase: 'after-click', hint: after.match(CAPTCHA_WORDS)?.[0] })
      if (onShot) await screenshot(cdp, onShot)
      return { ok: false, reason: 'captcha', events, clicked }
    }
  }

  const after = await readPea(cdp)
  note({ event: 'pea', when: 'after', value: after })
  if (onShot) await screenshot(cdp, onShot)
  return { ok: true, clicked, before, after, delta: (after ?? 0) - (before ?? 0), events }
}
