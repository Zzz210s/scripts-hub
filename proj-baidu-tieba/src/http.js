// 贴吧 HTTP 传输层:统一 UA/Referer/Cookie 头、AbortController 超时与错误归一。
//
// 不用 got/axios:fetchImpl 从 deps 注入,默认 globalThis.fetch。本文件不抛异常 ——
// 网络错、超时、非 JSON 一律归一为返回值(调用方只判 ok/status,不用包 try)。
// 失败附机器可读的 `reason`(`'http'` / `'network'` / `'parse'`),协议事实见同目录 NOTICE。

const DEFAULT_TIMEOUT_MS = 10000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const REFERER = 'https://tieba.baidu.com/';
const FORM = 'application/x-www-form-urlencoded';

/** 从 cookie 串里取一个字段,取不到返回 null。 */
export function cookieValue(cookie, name) {
  const found = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(cookie ?? '');
  return found ? found[1] : null;
}

/**
 * 统一请求:注入 fetchImpl、AbortController 超时、UA/Referer/Cookie 头。
 * 永不抛:失败归一为 `{ ok:false, error, reason }`,成功为 `{ ok:true, data }`。
 * cookie 为空时不发 Cookie 头(否则会发出字面量 "undefined")。
 */
export async function request(url, { cookie, deps, method = 'GET', headers = {}, body } = {}) {
  let timer;
  try {
    const fetchImpl = deps?.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const allHeaders = { 'User-Agent': UA, Referer: REFERER, ...headers };
    if (cookie) allHeaders.Cookie = cookie;
    const res = await fetchImpl(url, {
      method,
      headers: allHeaders,
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${String(text).slice(0, 120)}`, reason: 'http' };
    }
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, error: `响应不是 JSON:${String(text).slice(0, 120)}`, reason: 'parse' };
    }
  } catch (error) {
    const message = error?.name === 'AbortError' ? '请求超时' : (error?.message ?? String(error));
    return { ok: false, error: message, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export { DEFAULT_TIMEOUT_MS, FORM, REFERER, UA };
