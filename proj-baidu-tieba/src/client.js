// 贴吧 HTTP 客户端:三个请求(取 tbs / 关注列表 / 签到)。
//
// 传输层(UA、超时、请求归一)在 ./http.js;本文件只管协议形状与业务归一。
// 本文件不抛异常 —— 网络错、超时、非 JSON 一律归一为返回值。这是守卫与编排能可靠
// 工作的前提(调用方只判 ok/status,不用包 try)。协议出处见同目录 NOTICE。
//
// 失败一律附机器可读的 `reason`(与 ok/status 正交),取值:
//   'ok'        本跳拿到可用响应;业务层结论另看 ok / status
//   'auth'      服务器明确说未登录(newmoindex 的 error 文案里带「登录」);换 cookie 才能解决
//   'rejected'  服务器回了非 0 的 error_code(如贴吧已被屏蔽 340006);不是凭据问题、
//               也不是形状问题,编排按业务拒绝处理
//   'http'      非 2xx
//   'network'   连接失败或超时(可重试)
//   'parse'     响应不是 JSON,或缺少必需字段
//   'no-cookie' cookie 里没有 BDUSS,连请求都没发
// 编排据此区分「可重试的传输失败」与「永久失败」。

import { cookieValue, FORM, request } from './http.js';
import { buildSignParams, judgeSign, parseSignResponse, SIGN_STATUS } from './sign.js';

const URLS = Object.freeze({
  // 会话与关注列表都从这一个接口拿:它一次给出 uid、客户端 tbs 与 like_forum[](含 is_sign)。
  // 2026-10-14 真机实测:旧的 `/dc/common/tbs` 会回 `is_login: 0` 而同一份 cookie 在
  // 这里与 sign 接口上都正常 —— 拿它当凭据闸门会把有效凭据误判成失效(见 NOTICE)。
  session: 'https://tieba.baidu.com/mo/q/newmoindex',
  sign: 'https://c.tieba.baidu.com/c/c/forum/sign',
});

/** 布尔化:`1` / `"1"` / `true` 为真,其余为假(is_sign / is_forbidden 两种类型都出现过)。 */
function toFlag(value) {
  return value === 1 || value === '1' || value === true;
}

/**
 * 吧等级:`like_forum[].user_level` 是字符串(如 `"8"`)。转不成非负整数就给 null ——
 * 消息层渲染成 `Lv?`,绝不拿经验值或其它数字顶替。
 */
function toLevel(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** 响应里是否带非 0 的顶层 error_code(即服务器拒绝了这次请求)。 */
function hasErrorCode(data) {
  const raw = data?.error_code;
  if (raw === undefined || raw === null || raw === '') return false;
  const code = Number(raw);
  return Number.isFinite(code) && code !== 0;
}

/** 从响应里取一句人类可读的报错;取不到返回 null。 */
function responseMessage(data) {
  const text = data?.error_msg || data?.error?.usermsg || data?.error?.errmsg || null;
  return text === null ? null : String(text);
}

/**
 * 取会话:`GET /mo/q/newmoindex` 一次给出 uid、客户端 tbs(`data.itb_tbs`)与已关注吧列表。
 *
 * 凭据失效怎么判:`data` 缺失或 `no !== 0` 即视为没拿到会话;错误文案里带「登录」的归
 * `'auth'`,其余非 0 归 `'rejected'`。**不再看 `/dc/common/tbs` 的 `is_login`** —— 真机实测
 * 它对有效凭据也回 0(见 NOTICE),那是我们上一版误判「凭据已失效」的根因。
 *
 * tbs 取 `data.itb_tbs`(26 位客户端串,真机验证可直接用于 sign);缺失时退回 `data.tbs`。
 * 两者都没有 = 形状不对(reason `'parse'`)。
 *
 * @returns {Promise<{ ok: boolean, tbs: string|null, uid: string|null,
 *                     forums: Array|null, count: number, error: string|null, reason: string }>}
 */
export async function fetchSession({ cookie, deps } = {}) {
  const failure = (error, reason) => ({ ok: false, tbs: null, uid: null, forums: null, count: 0, error, reason });
  if (!cookieValue(cookie, 'BDUSS')) return failure('cookie 里没有 BDUSS', 'no-cookie');
  const res = await request(URLS.session, { cookie, deps });
  if (!res.ok) return failure(res.error, res.reason);
  const data = res.data?.data;
  const no = Number(res.data?.no);
  const rawError = typeof res.data?.error === 'string' ? res.data.error : '';
  if (!data || typeof data !== 'object') {
    // 三种都不是「有会话」:明确说未登录 -> auth;非 0 no 有别的含义 -> rejected;其余是形状不对。
    if (/登录|login/i.test(rawError)) return failure(rawError, 'auth');
    if (Number.isFinite(no) && no !== 0) return failure(rawError || `接口返回 no=${no}`, 'rejected');
    return failure(rawError && rawError !== 'success' ? rawError : '响应里没有 data', 'parse');
  }
  const tbs = typeof data.itb_tbs === 'string' && data.itb_tbs !== '' ? data.itb_tbs : data.tbs;
  if (typeof tbs !== 'string' || tbs === '') return failure('响应里没有可用的 tbs', 'parse');
  const list = Array.isArray(data.like_forum) ? data.like_forum : [];
  const forums = list.map((item) => ({
    fid: item?.forum_id ?? null,
    kw: item?.forum_name ?? null,
    level: toLevel(item?.user_level),
    isSign: toFlag(item?.is_sign),
    isForbidden: toFlag(item?.is_forbidden),
  }));
  return { ok: true, tbs, uid: data.uid === undefined ? null : String(data.uid), forums, count: forums.length, error: null, reason: 'ok' };
}

/** 取 tbs:`fetchSession` 的薄视图(调用方只需要 tbs 时用它)。 */
export async function fetchTbs({ cookie, deps } = {}) {
  const session = await fetchSession({ cookie, deps });
  return { ok: session.ok, tbs: session.tbs, error: session.error, reason: session.reason };
}

/**
 * 取已关注贴吧列表:`fetchSession` 的薄视图。`like_forum` 是**单次全量**返回(真机实测
 * 136 个吧一次给全),所以 `hasMore` 恒为假;`count` 就是列表长度。
 * 每项带 `level`(吧等级,转不成数字则为 null)供逐吧明细消息渲染。
 *
 * 注意 `count === 0` 的歧义:`ok:true` + `count:0` 既可能是「合法地关注 0 个吧」,也可能是
 * 「列表读不到但没报错」;下游必须单独处理这个取值,不能当成「全部已签」。
 *
 * @returns {Promise<{ ok: boolean, forums: Array|null, hasMore: boolean,
 *                     count: number, error: string|null, reason: string }>}
 */
export async function fetchFollowedForums({ cookie, deps } = {}) {
  const session = await fetchSession({ cookie, deps });
  return {
    ok: session.ok,
    forums: session.forums,
    hasMore: false,
    count: session.count,
    error: session.error,
    reason: session.reason,
  };
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
