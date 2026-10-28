// 登录:把新的 MUSIC_U 写进 .env,清掉当天的熔断标记,再用只读接口自证一次。
//
// 为什么要专门一个入口:网易云的凭据约一周失效一次,而程序刻意**不做登录**(不碰账号密码/
// 短信/扫码)。人工换 cookie 若靠手改 .env,容易漏掉两件事——文件权限、以及当天的熔断标记
// 还挂着(守卫会继续报「今天已熔断」而不去试新凭据)。
import fs from 'node:fs'
import path from 'node:path'

import { loadConfig } from './config.js'
import { readState, writeState } from './state.js'
import { logicalDay } from './clock.js'

const COOKIE_KEY = 'MUSIC_U'
// MUSIC_U 是长串字母数字(实测 60+ 位);这里只校验形状,长度阈值放宽,避免把合法值挡掉。
const COOKIE_VALUE = /^[A-Za-z0-9%._-]{20,}$/

/** 从粘贴内容里取出 cookie 值:支持整条 cURL、`cookie:` 头、`MUSIC_U=xxx`、以及裸值。 */
export function parseCookieInput(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: '内容为空' }
  // 1) 带 -H 'cookie: ...' 或 Cookie: ... 的整条 cURL / 请求头
  const header = text.match(/cookie["']?\s*:\s*["']?([^"'\n]+)/i)
  const haystack = header ? header[1] : text
  // 2) MUSIC_U=... 直接出现
  const named = haystack.match(new RegExp(`${COOKIE_KEY}=([^;\\s"']+)`))
  if (named) return check(named[1])
  // 3) 裸值(用户只贴了值本身)
  return check(haystack.split(/[;\s"']+/)[0])
}

function check(value) {
  const cookie = String(value ?? '').trim()
  if (!COOKIE_VALUE.test(cookie)) {
    return { ok: false, error: `看起来不是 MUSIC_U 的值 · 长度 ${cookie.length} · 应为一长串字母数字` }
  }
  return { ok: true, cookie }
}

/**
 * 把 cookie 写进 .env:只改这一行,其余行(其它开关、别的账号)原样保留;文件权限收紧到 600。
 * 返回写回的整行文本,便于上层打印「改的是哪个键」而不打印值。
 */
export function saveCookieToEnv({ cwd, cookie, account = 1, fsImpl = fs }) {
  const file = path.join(cwd, '.env')
  const key = `ACCOUNT_${account}_MUSIC_U`
  let lines = []
  try {
    lines = fsImpl.readFileSync(file, 'utf8').split(/\r?\n/)
  } catch {
    lines = []
  }
  const entry = `${key}=${cookie}`
  let replaced = false
  const out = lines.map((line) => {
    if (new RegExp(`^\\s*${key}\\s*=`).test(line)) {
      replaced = true
      return entry
    }
    return line
  })
  if (!replaced) {
    // 文件末尾可能已有空行,避免越写越多
    while (out.length && out[out.length - 1].trim() === '') out.pop()
    out.push(entry)
  }
  const body = `${out.join('\n')}\n`
  fsImpl.writeFileSync(file, body, { mode: 0o600 })
  try {
    fsImpl.chmodSync(file, 0o600)
  } catch {
    // Windows 上 chmod 基本无效,失败不算错
  }
  return { ok: true, key, replaced }
}

/** 清掉当天的熔断标记:换了新凭据,就不该再被「今天已熔断」挡着。 */
export function clearCircuitFor({ cwd, now = new Date(), fsImpl = fs }) {
  // readState 返回 { state, warnings },不是 state 本身
  const { state } = readState(path.join(cwd, 'data'), { fsImpl })
  const day = logicalDay(now)
  const entry = state.days?.[day]
  if (!entry || entry.circuitBroken !== true) return { ok: true, cleared: false, day }
  entry.circuitBroken = false
  entry.circuitKind = null
  writeState(state, path.join(cwd, 'data'), now, { fsImpl })
  return { ok: true, cleared: true, day }
}

/**
 * 一次完整的换凭据动作:解析 -> 写 .env -> 清熔断 -> 用只读接口自证。
 * `verify` 由调用方注入(默认用 client 的只读查询),便于离线测试。
 */
export async function loginWithCookie({ cwd, raw, account = 1, now = new Date(), deps = {} }) {
  const parsed = parseCookieInput(raw)
  if (!parsed.ok) return { ok: false, step: 'parse', error: parsed.error }
  const fsImpl = deps.fsImpl ?? fs
  const saved = saveCookieToEnv({ cwd, cookie: parsed.cookie, account, fsImpl })
  const cleared = clearCircuitFor({ cwd, now, fsImpl })
  const verify = deps.verify
  if (typeof verify !== 'function') {
    return { ok: true, step: 'saved', account, cleared: cleared.cleared, verified: null }
  }
  const config = deps.config ?? loadConfig(cwd, { env: deps.env ?? process.env, fsImpl })
  const verified = await verify({ cookie: `MUSIC_U=${parsed.cookie}`, config, deps })
  return { ok: true, step: 'saved', account, cleared: cleared.cleared, verified }
}

// CLI(宿主侧用):node src/login.js --file <路径> | --cookie "<内容>" [--account N]
// 只写 .env 与清熔断,**不做自证** —— 宿主机上没有 fetch 依赖的那套 client 上下文;
// 自证由 `docker compose run --rm -T netease-run check` 在容器里完成。
// 为什么要有这个入口:容器里 .env 是只读挂载(compose 有意为之),容器写不了,只能宿主写。
if (process.argv[1] && process.argv[1].endsWith('login.js')) {
  const argv = process.argv.slice(2)
  const pick = (flag) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const account = Number(pick('--account') ?? 1) || 1
  let raw = pick('--cookie')
  const file = pick('--file')
  if (!raw && file) raw = fs.readFileSync(file, 'utf8')
  const result = await loginWithCookie({ cwd: process.cwd(), raw, account })
  if (!result.ok) {
    process.stderr.write(`[失败] ${result.error}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`[保存] ACCOUNT_${result.account}_MUSIC_U 已写入 .env · 权限 600\n`)
    process.stdout.write(`[熔断] ${result.cleared ? '已清掉当天的熔断标记' : '当天本来没有熔断标记'}\n`)
  }
}
