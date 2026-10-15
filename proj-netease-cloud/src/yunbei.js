// T5:云贝只读查询(设计文档范围 A2 —— 只查询,不做云贝签到)。
// 两条 weapi 查询都只要 cookie:
//   1. /weapi/point/signed/get   —— 连续天数与本次贝壳
//   2. /weapi/point/today/get    —— 今日所得
// 只读、不写、不重试、不猜:字段读不到就如实返回 null,渲染成「未知」而不是编一个数。
// 路径只从 crypto.js 的 PATHS 取;字段读法集中在 fields.js(2026-10-15 真机实测后写死)。
import { call } from './client.js'
import { PATHS } from './crypto.js'
import { readYunbei, YUNBEI_SIGNED_PATH, YUNBEI_TODAY_PATH } from './fields.js'
import { pace } from './pacing.js'

/**
 * 查询云贝状态。返回 { ok, days, shells, todayShells, raw },永不抛。
 * 真机实测(2026-10-15):`/weapi/point/signed/get` 给 `{days, shells}`,
 * `/weapi/point/today/get` 给 `{shells}` —— 接口里没有「余额」这个概念,
 * 所以只呈现这三个数,读不到就为 null(渲染成「未知」),不编数、不拿别的字段冒充余额。
 * 第一段失败即 ok:false,渲染成「暂不可用」。
 */
export async function queryYunbei({ cookie, deps } = {}) {
  const signed = await call({ url: PATHS[YUNBEI_SIGNED_PATH], crypto: 'weapi', data: {}, cookie, deps })
  if (!signed.ok) {
    return { ok: false, days: null, shells: null, todayShells: null, raw: { signed } }
  }
  await pace(deps)
  const today = await call({ url: PATHS[YUNBEI_TODAY_PATH], crypto: 'weapi', data: {}, cookie, deps })
  const parsed = readYunbei(signed.body, today.ok ? today.body : null)
  return { ok: true, ...parsed, raw: { signed, today } }
}

export function renderYunbeiLine(yunbei) {
  if (!yunbei || yunbei.ok !== true) return '云贝:暂不可用'
  const parts = []
  parts.push(yunbei.todayShells === null ? '今日 +未知' : `今日 +${yunbei.todayShells}`)
  parts.push(yunbei.days === null ? '连续未知' : `连续 ${yunbei.days} 天`)
  if (yunbei.shells !== null) parts.push(`本次 ${yunbei.shells}`)
  return `云贝:${parts.join(' · ')}`
}
