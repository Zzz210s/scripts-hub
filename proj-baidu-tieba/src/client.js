// 贴吧 HTTP 客户端:三个请求(取 tbs / 关注列表 / 签到)。
//
// 不用 got/axios:fetchImpl 从 deps 注入,默认 globalThis.fetch。超时与 UA 统一在这里。
// 本文件不抛异常 —— 网络错、超时、非 JSON 一律归一为返回值。这是守卫与编排能可靠
// 工作的前提(调用方只判 ok/status,不用包 try)。协议出处见同目录 NOTICE。
//
// 失败一律附机器可读的 `reason`(与 ok/status 正交),取值:
//   'ok'        本跳拿到可用响应;业务层结论另看 ok / status
//   'auth'      服务器明确拒绝,换凭据才能解决(is_login 为假,或顶层 error_code 非 0)
//   'http'      非 2xx
//   'network'   连接失败或超时(可重试)
//   'parse'     响应不是 JSON,或缺少必需字段
//   'no-cookie' cookie 里没有 BDUSS,连请求都没发
// 编排据此区分「可重试的传输失败」与「永久失败」。

import { buildSignParams, judgeSign, parseSignResponse, SIGN_STATUS } from './sign.js';

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_PAGES = 10;
const PAGE_SIZE = 200;
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

/** 响应里是否带非 0 的顶层 error_code(即服务器拒绝了这次请求)。 */
function hasErrorCode(data) {
  const raw = data?.error_code;
  if (raw === undefined || raw === null || raw === '') return false;
  const code = Number(raw);
  return Number.isFinite(code) && code !== 0;
}

/** 响应没给出可用数据时,判别是「凭据被拒」还是「形状不对」。 */
function payloadReason(data) {
  if (data && data.is_login !== undefined && !toFlag(data.is_login)) return 'auth';
  return hasErrorCode(data) ? 'auth' : 'parse';
}

/** 从响应里取一句人类可读的报错;取不到返回 null。 */
function responseMessage(data) {
  const text = data?.error_msg || data?.error?.usermsg || data?.error?.errmsg || null;
  return text === null ? null : String(text);
}

/**
 * 统一请求:注入 fetchImpl、AbortController 超时、UA/Referer/Cookie 头。
 * 永不抛:失败归一为 `{ ok:false, error, reason }`,成功为 `{ ok:true, data }`。
 * cookie 为空时不发 Cookie 头(否则会发出字面量 "undefined")。
 */
async function request(url, { cookie, deps, method = 'GET', headers = {}, body } = {}) {
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

/**
 * 取 tbs。`is_login` 为假 = 凭据失效(reason `'auth'`),不算拿到 tbs。
 * @returns {Promise<{ ok: boolean, tbs: string|null, error: string|null, reason: string }>}
 */
export async function fetchTbs({ cookie, deps } = {}) {
  const res = await request(URLS.tbs, { cookie, deps });
  if (!res.ok) return { ok: false, tbs: null, error: res.error, reason: res.reason };
  if (!toFlag(res.data?.is_login)) {
    return { ok: false, tbs: null, error: '未登录或凭据已失效', reason: 'auth' };
  }
  const tbs = res.data?.tbs;
  if (typeof tbs !== 'string' || tbs === '') {
    return { ok: false, tbs: null, error: '响应里没有 tbs', reason: 'parse' };
  }
  return { ok: true, tbs, error: null, reason: 'ok' };
}

/** 关注列表失败时的统一返回。 */
function forumsFailure(error, reason) {
  return { ok: false, forums: null, hasMore: false, count: 0, error, reason };
}

/**
 * 取已关注贴吧列表,`like_forum[]` -> `{ fid, kw, isSign, isForbidden }`。
 * 按 `like_forum_has_more` 翻页(每页 200),最多 `MAX_PAGES` 页防死循环。
 * `hasMore` 为真 = 达上限仍未取完,下游必须拒绝锁当天(Task 5)。
 * @returns {Promise<{ ok: boolean, forums: Array|null, hasMore: boolean,
 *                     count: number, error: string|null, reason: string }>}
 */
export async function fetchFollowedForums({ cookie, deps } = {}) {
  const forums = [];
  let hasMore = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = new URLSearchParams({
      sort_type: '3',
      call_from: '3',
      page_no: String(page),
      res_num: String(PAGE_SIZE),
    }).toString();
    const res = await request(URLS.forumGuide, {
      cookie,
      deps,
      method: 'POST',
      headers: { 'Subapp-Type': 'hybrid', 'Content-Type': FORM },
      body,
    });
    if (!res.ok) return forumsFailure(res.error, res.reason);
    const list = res.data?.like_forum;
    // 空列表也要再看一眼 error_code:凭据失效时可能回 like_forum: [] 而不是缺字段。
    if (!Array.isArray(list) || (list.length === 0 && hasErrorCode(res.data))) {
      const error = responseMessage(res.data) ?? '响应里没有可用的 like_forum 数组';
      return forumsFailure(error, payloadReason(res.data));
    }
    for (const item of list) {
      forums.push({
        fid: item?.forum_id ?? null,
        kw: item?.forum_name ?? null,
        isSign: toFlag(item?.is_sign),
        isForbidden: toFlag(item?.is_forbidden),
      });
    }
    if (!toFlag(res.data?.like_forum_has_more)) break;
    if (page === MAX_PAGES) hasMore = true;
  }
  return { ok: true, forums, hasMore, count: forums.length, error: null, reason: 'ok' };
}

/**
 * 签到单个吧。返回 `{ status, error, reason }`:
 * `status` 是 Task 2 的五态判定;`reason` 描述这一跳的传输/协议层结果
 * (`'ok'` = 拿到了可判定的业务响应,业务结论看 status)。BDUSS 从 cookie 串里取,
 * 取不到不发请求(reason `'no-cookie'`)。
 */
export async function signForum({ cookie, forum, tbs, deps } = {}) {
  const bduss = cookieValue(cookie, 'BDUSS');
  if (!bduss) {
    return { status: SIGN_STATUS.FAILED, error: 'cookie 里没有 BDUSS', reason: 'no-cookie' };
  }
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
  if (!res.ok) return { status: SIGN_STATUS.FAILED, error: res.error, reason: res.reason };
  const status = judgeSign(parseSignResponse(res.data));
  const done = status === SIGN_STATUS.SIGNED || status === SIGN_STATUS.ALREADY;
  return { status, error: done ? null : responseMessage(res.data), reason: 'ok' };
}
