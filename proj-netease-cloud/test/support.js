// 请求层测试共用的 fetchImpl 桩与工厂。不是测试文件(不匹配 *.test.js),不会被 node --test 当用例跑。
// 所有值都是 SAMPLE,不含任何真实凭据。
import { call } from '../src/client.js'
import { PATHS } from '../src/crypto.js'

export const COOKIE = 'MUSIC_U=SAMPLE_MUSIC_U_VALUE'

/** fetchImpl 桩:记录调用;reply 返回 { status, text } 或 { throw }。 */
export function stub(reply) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    const result = reply(url, options)
    if (result?.throw) throw result.throw
    return {
      ok: result.status === undefined || result.status < 400,
      status: result.status ?? 200,
      text: async () => result.text,
    }
  }
  return { calls, fetchImpl }
}

export const json = (payload) => () => ({ text: JSON.stringify(payload) })

/** 默认走 weapi 的 VIP 乐签;deps 与其它字段可由用例覆盖。 */
export const run = ({ fetchImpl, deps, ...rest }) =>
  call({ url: PATHS.vipSign, crypto: 'weapi', data: {}, cookie: COOKIE, ...rest, deps: { fetchImpl, ...deps } })

export const form = (body) => new URLSearchParams(body)
