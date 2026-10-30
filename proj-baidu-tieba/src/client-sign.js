// 贴吧客户端签名:c.tieba.baidu.com 的接口都要求 `sign` 参数。
//
// 算法:参数按键名升序排成 `a=1b=2c=3`,末尾拼固定盐 `tiebaclient!!!`,MD5 后转大写。
// 2026-10-30 真机实测:同一个 tid 的点赞请求,带签名回 `error_code:0`,不带/签名错回 300000。
//
// 只签**业务参数** —— `sign` 自身不能进待签名集合,否则算出来的值永远对不上。
import { createHash } from 'node:crypto';

const SALT = 'tiebaclient!!!';

/** 对参数对象签名,返回 32 位大写十六进制。参数里的 undefined/null 会被跳过。 */
export function clientSign(params = {}) {
  const raw = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('');
  return createHash('md5').update(`${raw}${SALT}`).digest('hex').toUpperCase();
}
