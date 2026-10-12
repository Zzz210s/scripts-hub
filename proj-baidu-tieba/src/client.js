// 贴吧 HTTP 客户端:三个请求(取 tbs / 关注列表 / 签到)。
//
// 传输层(UA、超时、请求归一)在 ./http.js;本文件只管协议形状与业务归一。
// 本文件不抛异常 —— 网络错、超时、非 JSON 一律归一为返回值。这是守卫与编排能可靠
// 工作的前提(调用方只判 ok/status,不用包 try)。协议出处见同目录 NOTICE。
//
// 失败一律附机器可读的 `reason`(与 ok/status 正交),取值:
//   'ok'        本跳拿到可用响应;业务层结论另看 ok / status
//   'auth'      服务器明确说凭据失效(响应里 `is_login` 为假);换 cookie 才能解决
//   'rejected'  服务器回了非 0 的 error_code(如贴吧已被屏蔽 340006);不是凭据问题、
//               也不是形状问题,编排按业务拒绝处理
//   'http'      非 2xx
//   'network'   连接失败或超时(可重试)
//   'parse'     响应不是 JSON,或缺少必需字段
//   'no-cookie' cookie 里没有 BDUSS,连请求都没发
// 编排据此区分「可重试的传输失败」与「永久失败」。

import { cookieValue, FORM, request } from './http.js';
import { buildSignParams, judgeSign, parseSignResponse, SIGN_STATUS } from './sign.js';

const MAX_PAGES = 10;
const PAGE_SIZE = 200;

const URLS = Object.freeze({
  tbs: 'https://tieba.baidu.com/dc/common/tbs',
  forumGuide: 'https://tieba.baidu.com/c/f/forum/forumGuide',
  sign: 'https://c.tieba.baidu.com/c/c/forum/sign',
});

/** 布尔化:`1` / `"1"` / `true` 为真,其余为假(is_sign / is_forbidden 两种类型都出现过)。 */
function toFlag(value) {
  return value === 1 || value === '1' || value === true;
}

/** 响应里是否带非 0 的顶层 error_code(即服务器拒绝了这次请求)。 */
function hasErrorCode(data) {
  const raw = data?.error_code;
  if (raw === undefined || raw === null || raw === '') return false;
  const code = Number(raw);
  return Number.isFinite(code) && code !== 0;
}

/**
 * 服务器的**明确拒绝信号**:`is_login` 为假 -> `'auth'`;否则非 0 error_code ->
 * `'rejected'`;两者都没有 -> `null`。`null` 只表示「没有明确拒绝」,不代表响应可用 ——
 * 「有没有可用数据」是调用方自己按形状判的。
 */
function rejectionReason(data) {
  if (data && data.is_login !== undefined && !toFlag(data.is_login)) return 'auth';
  return hasErrorCode(data) ? 'rejected' : null;
}

/** 从响应里取一句人类可读的报错;取不到返回 null。 */
function responseMessage(data) {
  const text = data?.error_msg || data?.error?.usermsg || data?.error?.errmsg || null;
  return text === null ? null : String(text);
}

/**
 * 取 tbs。`is_login` 为假 = 凭据失效(reason `'auth'`),不算拿到 tbs。
 * cookie 里没有 BDUSS 时先判 `'no-cookie'`,不发匿名请求。
 * @returns {Promise<{ ok: boolean, tbs: string|null, error: string|null, reason: string }>}
 */
export async function fetchTbs({ cookie, deps } = {}) {
  if (!cookieValue(cookie, 'BDUSS')) {
    return { ok: false, tbs: null, error: 'cookie 里没有 BDUSS', reason: 'no-cookie' };
  }
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
 * 按 `like_forum_has_more` 翻页(每页 200),最多 `MAX_PAGES` 页防死循环;重复的 `fid`
 * 只保留第一条(服务端忽略 `page_no` 时会连续回同一批),故 `count` 是去重后的数量。
 * `hasMore` 为真 = 达上限仍未取完,下游必须拒绝锁当天(Task 5)。
 *
 * 注意 `count === 0` 有歧义:`ok:true` + `count:0` 既可能是「合法地关注 0 个吧」,
 * 也可能是「关注列表读不到但没报错」;下游(Task 4/5)必须单独处理这个取值,不能把它
 * 当成「全部已签」。
 *
 * @returns {Promise<{ ok: boolean, forums: Array|null, hasMore: boolean,
 *                     count: number, error: string|null, reason: string }>}
 */
export async function fetchFollowedForums({ cookie, deps } = {}) {
  if (!cookieValue(cookie, 'BDUSS')) return forumsFailure('cookie 里没有 BDUSS', 'no-cookie');
  const forums = [];
  const seen = new Set();
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
    const rejection = rejectionReason(res.data);
    const message = responseMessage(res.data) ?? '响应里没有可用的 like_forum 数组';
    // 不是数组 = 形状不对;空数组则看服务器有没有明确拒绝 —— 凭据失效时可能回
    // `like_forum: []` 而不是缺字段,而合法地关注 0 个吧也会回 `[]`。
    if (!Array.isArray(list)) return forumsFailure(message, rejection ?? 'parse');
    if (list.length === 0 && rejection !== null) return forumsFailure(message, rejection);
    for (const item of list) {
      const fid = item?.forum_id ?? null;
      if (fid !== null) {
        if (seen.has(fid)) continue;
        seen.add(fid);
      }
      forums.push({
        fid,
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
 * `status` 是 Task 2 的五态判定;`reason` 描述这一跳的传输/协议层结果 ——
 * `'ok'` = 拿到了**可判定的**响应(业务结论看 status,连「已签到」「被屏蔽」都算拿到了
 * 服务器答复);`'parse'` = 响应里拿不到可用判定(空对象、非 JSON),编排可重试。
 * BDUSS 从 cookie 串里取,取不到不发请求(reason `'no-cookie'`)。
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
  const parsed = parseSignResponse(res.data);
  const status = judgeSign(parsed);
  const done = status === SIGN_STATUS.SIGNED || status === SIGN_STATUS.ALREADY;
  const understood = parsed.ok || status !== SIGN_STATUS.FAILED;
  return {
    status,
    error: done ? null : responseMessage(res.data),
    reason: understood ? 'ok' : 'parse',
  };
}
