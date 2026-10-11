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
