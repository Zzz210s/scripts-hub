// 贴吧签到协议的纯函数层:签名、参数构造。(响应解析与判定见同文件后半段)
//
// 本文件不做任何 I/O:不读环境变量、不发请求、不写文件。协议事实(salt、参数集合)
// 的核对出处写在同目录 NOTICE 里。

import { createHash } from 'node:crypto';

/** 签名 salt。协议事实,见 NOTICE。 */
export const SIGN_SALT = 'tiebaclient!!!';

/**
 * 签到必须携带的客户端伪装字段。协议事实,见 NOTICE。
 * 冻结:调用方改不了默认值,要覆盖就用 buildSignParams 的 clientFields。
 */
export const DEFAULT_CLIENT_FIELDS = Object.freeze({
  _client_type: '2',
  _client_version: '9.7.8.0',
  _phone_imei: '000000000000000',
  model: 'MI+5',
  net_type: '1',
});

/**
 * 按 key 升序把 `k=v` 直接拼接,不带分隔符、不做 urlencode。
 * 这是签名的原文,也是复现签名的唯一口径。
 */
export function canonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('');
}

/** 签名:md5(升序拼接串 + salt) 的大写十六进制。 */
export function signQuery(params) {
  return createHash('md5')
    .update(canonicalQuery(params) + SIGN_SALT, 'utf8')
    .digest('hex')
    .toUpperCase();
}

/** 把值统一成字符串;undefined/null 归一为空串。 */
function toParamString(value) {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * 构造签到请求参数。
 *
 * @param {{ bduss?: unknown, fid?: unknown, kw?: unknown, tbs?: unknown,
 *           timestamp?: unknown, clientFields?: Record<string, unknown> }} [input]
 * @returns {Record<string, string>} 含必需参数、伪装字段与 `sign`(大写)
 */
export function buildSignParams(input = {}) {
  const { bduss, fid, kw, tbs, timestamp, clientFields } = input ?? {};
  const params = {
    BDUSS: toParamString(bduss),
    fid: toParamString(fid),
    kw: toParamString(kw),
    tbs: toParamString(tbs),
    timestamp: toParamString(timestamp),
    ...DEFAULT_CLIENT_FIELDS,
    ...(clientFields ?? {}),
  };
  for (const key of Object.keys(params)) {
    params[key] = toParamString(params[key]);
  }
  params.sign = signQuery(params);
  return params;
}

// ---------- 响应解析与第一层判定 ----------

/** 第一层判定的结果枚举。Task 4 的账号计数键用 statusCountsKey 派生,不要各处自己拼。 */
export const SIGN_STATUS = Object.freeze({
  SIGNED: 'signed',
  ALREADY: 'already',
  BLOCKED: 'blocked',
  TBS_STALE: 'tbs-stale',
  FAILED: 'failed',
});

/** 状态 -> 计数键:`tbs-stale` 的驼峰视图是 `tbsStale`,其余原样。 */
export function statusCountsKey(status) {
  return status === SIGN_STATUS.TBS_STALE ? 'tbsStale' : status;
}

const CODE_OK = 0;
const CODE_ALREADY = 160002;
const CODE_BLOCKED = 340006;
const CODE_TBS_STALE = 320022;

/** 数值化。空串 / null / undefined / 非数字一律归一为 null,表示「该字段没有」。 */
function toNumOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * 解析签到响应。入参可以是响应文本或已解析的对象。
 *
 * `ok` 只表示「响应本身可用且顶层没报错」;它**不等于**签到成功 ——
 * 签到是否真的成功由 judgeSign 用业务字段判定。
 *
 * `raw` 是解析后的完整响应对象(解析失败为 null),供下游取 `error_msg` 一类的原文。
 *
 * @returns {{ ok: boolean, code: number|null, errno: number|null,
 *             bonusPoint: number|null, isSignIn: string|null, raw: object|null }}
 */
export function parseSignResponse(body) {
  let raw = body;
  if (typeof body === 'string') {
    try {
      raw = JSON.parse(body);
    } catch {
      raw = null;
    }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: null, errno: null, bonusPoint: null, isSignIn: null, raw: null };
  }
  const code = toNumOrNull(raw.error_code);
  const errorObj = raw.error && typeof raw.error === 'object' ? raw.error : null;
  const errno = errorObj ? toNumOrNull(errorObj.errno) : null;
  const info = raw.user_info && typeof raw.user_info === 'object' ? raw.user_info : null;
  return {
    ok: code === CODE_OK && (errno === null || errno === CODE_OK),
    code,
    errno,
    bonusPoint: info ? toNumOrNull(info.sign_bonus_point) : null,
    isSignIn:
      info && info.is_sign_in !== null && info.is_sign_in !== undefined
        ? String(info.is_sign_in)
        : null,
    raw,
  };
}

/**
 * 第一层判定。优先级:嵌套 `error.errno` > 顶层 `error_code` > 业务字段。
 *
 * 顶层 `error_code` 为 `"0"` 不代表成功(一手样例:真错误藏在 `error.errno` 里),
 * 所以只有「顶层 0 且没有嵌套错误」时才看 `user_info` ——
 * `sign_bonus_point > 0` 或 `is_sign_in === "1"` 才算真签进去了。
 * 拿不准时返回 FAILED,不猜成功(对账是最终权威口径)。
 */
export function judgeSign(parsed) {
  if (parsed === null || typeof parsed !== 'object') return SIGN_STATUS.FAILED;
  const { code, errno, bonusPoint, isSignIn } = parsed;
  const effective = errno !== null && errno !== undefined && errno !== CODE_OK ? errno : code;
  switch (effective) {
    case CODE_TBS_STALE:
      return SIGN_STATUS.TBS_STALE;
    case CODE_ALREADY:
      return SIGN_STATUS.ALREADY;
    case CODE_BLOCKED:
      return SIGN_STATUS.BLOCKED;
    case CODE_OK:
      break;
    default:
      return SIGN_STATUS.FAILED;
  }
  if (bonusPoint !== null && bonusPoint !== undefined && bonusPoint > 0) {
    return SIGN_STATUS.SIGNED;
  }
  if (isSignIn === '1') return SIGN_STATUS.SIGNED;
  return SIGN_STATUS.FAILED;
}
