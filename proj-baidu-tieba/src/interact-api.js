// 互动接口层:拉帖子列表 / 回帖 / 点赞。只做协议与归一,不抛异常。
//
// 三个接口都是 2026-10-30 真机探出来的(见同目录 NOTICE 的「互动」一节):
//
//   列表 GET  https://c.tieba.baidu.com/c/f/frs/page?kw=&rn=&pn=&_client_type=2&_client_version=…&sign=
//   回帖 POST https://tieba.baidu.com/f/commit/post/add
//        ie=utf-8 · kw · fid · tid · content · tbs      回 {"no":0,"err_code":0,"data":{…}}
//   点赞 POST https://c.tieba.baidu.com/c/c/agree/opAgree
//        obj_id=tid · thread_id=tid · obj_type=3 · agree_type=1 · tbs · _client_type · _client_version · sign
//        回 {"error_code":"0"} 或 {"error_code":"3280001"} —— 后者是「已经点过赞」,算成功
//
// 回帖的 `experience` 字段恒为 0,不要拿它当经验增量:真值只能靠事后重读会话比对。

import { request } from './http.js';
import { clientSign } from './client-sign.js';

const CLIENT_UA = 'bdtb for Android 12.0.0';
const LIST_URL = 'https://c.tieba.baidu.com/c/f/frs/page';
const POST_URL = 'https://tieba.baidu.com/f/commit/post/add';
const AGREE_URL = 'https://c.tieba.baidu.com/c/c/agree/opAgree';

/** 风控迹象:出现就整体停下,继续打只会把账号往黑名单里推。 */
const RISK_PATTERN = /(安全验证|验证码|操作频繁|操作太快|稍后再试|账号异常|被封|禁止)/;

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 拉吧内最新帖子,返回 tid 数组。只读,不会造成任何副作用。 */
export async function fetchThreads({ kw, limit = 10, cookie, deps } = {}) {
  const params = {
    kw: String(kw ?? ''),
    rn: String(limit),
    pn: '0',
    _client_type: '2',
    _client_version: '12.0.0'
  };
  params.sign = clientSign(params);
  const res = await request(`${LIST_URL}?${new URLSearchParams(params)}`, {
    cookie,
    deps,
    headers: { 'User-Agent': CLIENT_UA }
  });
  if (!res.ok) return { ok: false, tids: [], error: res.error, reason: res.reason };
  const list = res.data?.thread_list;
  if (!Array.isArray(list)) return { ok: false, tids: [], error: '响应里没有 thread_list', reason: 'parse' };
  const tids = list
    .map((item) => String(item?.id ?? item?.tid ?? ''))
    .filter((tid) => /^\d{6,}$/.test(tid));
  return { ok: true, tids, error: null, reason: 'ok', risk: null };
}

/**
 * 回帖。`ok:true` 只代表服务端接受 —— 经验是否到账要事后重读会话才知道。
 * `risk` 非空表示触发了验证码/风控文案,调用方应整体停下。
 */
export async function postReply({ kw, fid, tid, content, tbs, cookie, deps } = {}) {
  const form = {
    ie: 'utf-8',
    kw: String(kw ?? ''),
    fid: String(fid ?? ''),
    tid: String(tid ?? '0'),
    content: String(content ?? ''),
    tbs: String(tbs ?? '')
  };
  const res = await request(POST_URL, { cookie, deps, method: 'POST', body: new URLSearchParams(form).toString() });
  if (!res.ok) return { ok: false, error: res.error, reason: res.reason, risk: null };
  const data = res.data ?? {};
  const no = num(data.no);
  const rawError = typeof data.error === 'string' ? data.error : '';
  const vcode = num(data.data?.vcode?.need_vcode) === 1 ? '需要验证码' : '';
  const risk = RISK_PATTERN.test(rawError) ? rawError : vcode || null;
  if (no === 0) return { ok: true, error: null, reason: 'ok', risk, pid: data.data?.pid ?? null };
  return { ok: false, error: rawError || `接口返回 no=${data.no}`, reason: 'rejected', risk };
}

/** 点赞。`3280001` 是「已经点过赞」,按成功算 —— 幂等,重跑不会报错。 */
export async function likeThread({ tid, tbs, cookie, deps } = {}) {
  const form = {
    obj_id: String(tid ?? ''),
    thread_id: String(tid ?? ''),
    obj_type: '3',
    agree_type: '1',
    tbs: String(tbs ?? ''),
    _client_type: '2',
    _client_version: '12.0.0'
  };
  form.sign = clientSign(form);
  const res = await request(AGREE_URL, {
    cookie,
    deps,
    method: 'POST',
    headers: { 'User-Agent': CLIENT_UA },
    body: new URLSearchParams(form).toString()
  });
  if (!res.ok) return { ok: false, already: false, error: res.error, reason: res.reason, risk: null };
  const data = res.data ?? {};
  const code = String(data.error_code ?? '');
  const message = typeof data.error_msg === 'string' ? data.error_msg : '';
  if (code === '0') return { ok: true, already: false, error: null, reason: 'ok', risk: null };
  if (code === '3280001') return { ok: true, already: true, error: null, reason: 'ok', risk: null };
  return {
    ok: false,
    already: false,
    error: message || `接口返回 error_code=${code}`,
    reason: 'rejected',
    risk: RISK_PATTERN.test(message) ? message : null
  };
}
