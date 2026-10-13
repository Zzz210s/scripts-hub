// 网易云 HTTP 客户端:统一 UA/Referer/Cookie 头、超时、weapi/eapi 参数封装与错误归一。
//
// 不引 axios/got:fetchImpl 从 deps 注入,默认 globalThis.fetch。本文件不抛异常 ——
// 网络错、超时、非 JSON、凭据缺失一律归一为返回值,调用方只判 ok/reason,不用包 try。
//
// 失败一律附机器可读的 reason(与 ok/code 正交),取值:
//   'ok'         传输与协议都成功(code 200,或响应没有 code 字段)
//   'auth'       服务器明确说凭据失效(code 301/302/8810/-462/-460);换 cookie 才能解决
//   'http'       非 2xx,或业务 code 非 200 且不属于凭据问题
//   'network'    连接失败或超时(可重试)
//   'parse'      响应不是 JSON,或 URL 不合法
//   'no-cookie'  cookie 里没有 MUSIC_U 或值为空,连请求都没发
//
// 契约钉死:本项目 reason 只有以上 6 个取值,调用方只在这个集合上分支,不要再猜。
// 风控类拒绝(如 code 447)目前归 'http' 并靠 code 区分;若 T6 的风控矩阵确需独立类别,
// 先在 T6 里把 'rejected' 加进这里并同步 client.test.js,不要在调用方凭空新增取值。
// 只发 MUSIC_U(cookie 值原样透传);不伪造设备指纹、不复用反作弊 token。
// eapi 的设备字段 os/deviceId/osver/appver/versioncode 当前一个都没发,已列入 NOTICE 的
// T3 待校正清单 —— 探针实测若要求,由 T6 在表头或表单里补,不在本层猜。
// 协议事实(UA、主机、Referer、表单形状)见同目录 NOTICE 与调研文档;T3 探针实测后只改这里的常量。
// 待 T3 校正的常量(连同 UA/HOSTS 一起记在 NOTICE):UA.weapi、UA.eapi、HOSTS 三项、
// Referer 'https://music.163.com/' 是否仍被接受。

import { eapiParams, weapiParams } from './crypto.js'

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_RETRY_DELAY_MS = 1500
const FORM = 'application/x-www-form-urlencoded'

/**
 * 真实客户端 UA:web 接口(weapi)用浏览器 UA,eapi 用移动端 UA —— 混用会与加密方式不匹配。
 * 值来自调研文档对 api-enhanced 源码的读取(NOTICE 记录出处),T3 探针按实测校正。
 */
export const UA = Object.freeze({
  weapi:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  eapi: 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)',
})

/** 默认主机:url 只给路径时按加密层补全。eapi 与 weapi 不在同一台机器上。 */
export const HOSTS = Object.freeze({
  weapi: 'https://music.163.com',
  eapi: 'https://interfacepc.music.163.com',
  none: 'https://music.163.com',
})

/** 表示「凭据失效」的业务 code;其余非 200 一律按接口失败处理。 */
const AUTH_CODES = Object.freeze([301, 302, 8810, -462, -460])

/** 从 cookie 串里取一个字段;取不到或值为空都返回 null(空 MUSIC_U 不算凭据)。 */
export function cookieValue(cookie, name) {
  const found = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(cookie ?? '')
  return found && found[1] !== '' ? found[1] : null
}

/** 从 URL 推断加密层:路径含 /eapi/ -> eapi,/weapi/ -> weapi,其余 none。 */
export function cryptoFromUrl(url) {
  const text = String(url ?? '')
  if (text.includes('/eapi/')) return 'eapi'
  if (text.includes('/weapi/')) return 'weapi'
  return 'none'
}

const snippet = (text) => String(text ?? '').replace(/\s+/g, ' ').slice(0, 120)

/** 业务 code 只认有限数;缺失、空串、非数字一律按「未解析」返回 null。 */
const parseCode = (value) => {
  if (value === undefined || value === null || value === '') return null
  const code = Number(value)
  return Number.isFinite(code) ? code : null
}

const fail = (error, reason, extra = {}) => ({
  ok: false,
  code: null,
  body: null,
  raw: null,
  error,
  reason,
  ...extra,
})

/** URL 只给路径时补主机。 */
function resolve(url, mode) {
  if (/^https?:\/\//i.test(url)) return new URL(url)
  return new URL(url, HOSTS[mode] ?? HOSTS.none)
}

/**
 * eapi 的摘要与明文都用逻辑路径 /api/...:参考实现先拿 /api/... 算摘要,再把 URL 重写成
 * /eapi/... 发请求;这里发送用的是 /eapi/... 形态,故算摘要前反向归一。不改 PATHS,是因为
 * 前缀同时被 cryptoFromUrl 与主机选择依赖。
 */
const logicalPath = (pathname) => pathname.replace(/^\/eapi\//, '/api/')

/** 组装请求体:weapi 双层加密 + RSA,eapi AES-ECB,none 走 JSON。 */
function buildBody(target, data, mode) {
  const payload = data ?? {}
  if (mode === 'weapi') {
    const { params, encSecKey } = weapiParams(payload)
    return new URLSearchParams({ params, encSecKey }).toString()
  }
  if (mode === 'eapi') {
    const { params } = eapiParams(logicalPath(target.pathname), payload)
    return new URLSearchParams({ params }).toString()
  }
  return JSON.stringify(payload)
}

/** 单次尝试:超时用 Promise.race 打断(不依赖 fetchImpl 是否尊重 signal),错误归一。 */
async function attemptOnce({ fetchImpl, target, verb, headers, body, timeoutMs }) {
  let timer
  let text
  try {
    const controller = new AbortController()
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(Object.assign(new Error('请求超时'), { name: 'TimeoutError' }))
      }, timeoutMs)
    })
    const pending = Promise.resolve().then(() =>
      fetchImpl(target.toString(), { method: verb, headers, body, signal: controller.signal }),
    )
    pending.catch(() => {})
    const res = await Promise.race([pending, timeout])
    text = await res.text()
    if (!res.ok) return fail(`HTTP ${res.status} · ${snippet(text)}`, 'http', { raw: text })
  } catch (error) {
    const aborted = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    const message = aborted ? '请求超时' : `网络错误 · ${error?.message ?? String(error)}`
    return fail(message, 'network')
  } finally {
    clearTimeout(timer)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return fail(`响应不是 JSON · ${snippet(text)}`, 'parse', { raw: text })
  }
  const code = parseCode(parsed && typeof parsed === 'object' ? parsed.code : undefined)
  if (code === null || code === 200) {
    return { ok: true, code, body: parsed, raw: text, error: null, reason: 'ok' }
  }
  const reason = AUTH_CODES.includes(code) ? 'auth' : 'http'
  const error = reason === 'auth' ? `未登录或凭据已失效 · code ${code}` : `接口返回失败 · code ${code}`
  return { ok: false, code, body: parsed, raw: text, error, reason }
}

/**
 * 调用一个网易云接口。返回 `{ ok, code, body, raw, error, reason }`;永不抛。
 * url 可以是完整 URL 或路径(路径按 crypto 补默认主机);crypto 省略时按路径前缀推断。
 * deps = { fetchImpl, timeoutMs, sleep, retries, retryDelayMs };只有 network 失败会退避重试,
 * 重试次数默认 0(单次尝试),sleep 可注入以便离线测试。
 */
export async function call(options = {}) {
  const { url, data, method, crypto, cookie, deps } = options
  const mode = crypto ?? cryptoFromUrl(url)
  if (cookieValue(cookie, 'MUSIC_U') === null) {
    return fail('cookie 里没有 MUSIC_U · 只用 MUSIC_U', 'no-cookie')
  }
  const verb = method ?? (mode === 'none' ? 'GET' : 'POST')
  let target
  let body
  try {
    target = resolve(url, mode)
    body = verb === 'GET' ? undefined : buildBody(target, data, mode)
  } catch (error) {
    return fail(`请求体组装失败 · ${error?.message ?? String(error)}`, 'parse')
  }
  const headers = {
    'User-Agent': UA[mode] ?? UA.weapi,
    'Content-Type': mode === 'none' ? 'application/json' : FORM,
    Cookie: cookie,
  }
  if (mode === 'none' || mode === 'weapi') headers.Referer = 'https://music.163.com/'
  const fetchImpl = deps?.fetchImpl ?? globalThis.fetch
  const sleep = deps?.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)))
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = deps?.retries ?? 0
  const retryDelayMs = deps?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS

  let attempt = 0
  for (;;) {
    const result = await attemptOnce({ fetchImpl, target, verb, headers, body, timeoutMs })
    if (result.reason !== 'network' || attempt >= retries) return result
    attempt += 1
    await sleep(retryDelayMs)
  }
}
