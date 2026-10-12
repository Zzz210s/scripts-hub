// 贴吧 HTTP 客户端:三个请求(取 tbs / 关注列表 / 签到)。
//
// 不用 got/axios:fetchImpl 从 deps 注入,默认 globalThis.fetch。超时与 UA 统一在这里。
// 本文件不抛异常 —— 网络错、超时、非 JSON 一律归一为返回值。这是守卫与编排能可靠
// 工作的前提(调用方只判 ok,不用包 try)。协议出处见同目录 NOTICE。

import { buildSignParams, judgeSign, parseSignResponse, SIGN_STATUS } from './sign.js';

const DEFAULT_TIMEOUT_MS = 10000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const REFERER = 'https://tieba.baidu.com/';
const FORM = 'application/x-www-form-urlencoded';

const URLS = Object.freeze({
  tbs: 'https://tieba.baidu.com/dc/common/tbs',
  forumGuide: 'https://tieba.baidu.com/c/f/forum/forumGuide',
  sign: 'https://c.tieba.baidu.com/c/c/forum/sign',
});

/** 布尔化:`1` / `"1"` / `true` 为真,其余为假(is_sign / is_forbidden 两种类型都出现过)。 */
function toFlag(value) {
  return value === 1 || value === '1' || value === true;
}

/** 从 cookie 串里取一个字段,取不到返回 null。 */
function cookieValue(cookie, name) {
  const found = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(cookie ?? '');
  return found ? found[1] : null;
}

/**
 * 统一请求:注入 fetchImpl、AbortController 超时、UA/Referer/Cookie 头。
 * 永不抛:失败归一为 `{ ok:false, error }`,成功为 `{ ok:true, data }`(data 是解析后的 JSON)。
 */
async function request(url, { cookie, deps = {}, method = 'GET', headers = {}, body } = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method,
      headers: { 'User-Agent': UA, Referer: REFERER, Cookie: cookie, ...headers },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${String(text).slice(0, 120)}` };
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: `响应不是 JSON:${String(text).slice(0, 120)}` };
    }
    return { ok: true, data };
  } catch (error) {
    const message =
      error?.name === 'AbortError' ? '请求超时' : (error?.message ?? String(error));
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取 tbs。`is_login` 为假 = 凭据失效,不算拿到 tbs。
 * @returns {Promise<{ ok: boolean, tbs: string|null, error: string|null }>}
 */
export async function fetchTbs({ cookie, deps } = {}) {
  const res = await request(URLS.tbs, { cookie, deps });
  if (!res.ok) return { ok: false, tbs: null, error: res.error };
  if (!toFlag(res.data?.is_login)) return { ok: false, tbs: null, error: '未登录或凭据已失效' };
  const tbs = res.data?.tbs;
  if (typeof tbs !== 'string' || tbs === '') return { ok: false, tbs: null, error: '响应里没有 tbs' };
  return { ok: true, tbs, error: null };
}

/**
 * 取已关注贴吧列表,`like_forum[]` -> `{ fid, kw, isSign, isForbidden }`。
 * @returns {Promise<{ ok: boolean, forums: Array|null, error: string|null }>}
 */
export async function fetchFollowedForums({ cookie, deps } = {}) {
  const body = new URLSearchParams({
    sort_type: '3',
    call_from: '3',
    page_no: '1',
    res_num: '200',
  }).toString();
  const res = await request(URLS.forumGuide, {
    cookie,
    deps,
    method: 'POST',
    headers: { 'Subapp-Type': 'hybrid', 'Content-Type': FORM },
    body,
  });
  if (!res.ok) return { ok: false, forums: null, error: res.error };
  const list = res.data?.like_forum;
  if (!Array.isArray(list)) return { ok: false, forums: null, error: '响应里没有 like_forum 数组' };
  const forums = list.map((item) => ({
    fid: item?.forum_id ?? null,
    kw: item?.forum_name ?? null,
    isSign: toFlag(item?.is_sign),
    isForbidden: toFlag(item?.is_forbidden),
  }));
  return { ok: true, forums, error: null };
}

/**
 * 签到单个吧。按需求书返回 Task 2 的判定结果(五态之一),不是 `{ ok, error }`:
 * 传输/解析失败一律归为 `failed`,由对账层兜底。BDUSS 从 cookie 串里取,取不到不发请求。
 */
export async function signForum({ cookie, forum, tbs, deps } = {}) {
  const bduss = cookieValue(cookie, 'BDUSS');
  if (!bduss) return SIGN_STATUS.FAILED;
  const params = buildSignParams({
    bduss,
    fid: forum?.fid,
    kw: forum?.kw,
    tbs,
    timestamp: Math.floor(Date.now() / 1000),
  });
  const res = await request(URLS.sign, {
    cookie,
    deps,
    method: 'POST',
    headers: { 'Content-Type': FORM },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) return SIGN_STATUS.FAILED;
  return judgeSign(parseSignResponse(res.data));
}
