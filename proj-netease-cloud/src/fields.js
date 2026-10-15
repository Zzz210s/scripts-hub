// VIP 乐签与云贝查询共用的「字段读法」。真源只有这一份:2026-10-15 真机实测后写死。
//
// 实测到的形状(只带 cookie 的 weapi 请求):
//   GET /weapi/vipnewcenter/app/level/growhpoint/basic
//       → {code:200,data:{userLevel:{level,growthPoint,yesterdayPoint,vipType,…}}}
//   GET /weapi/vipnewcenter/app/user/sign/info
//       → {code:200,data:[{timeStr:"2026-10-15",today:true,score:3,…}, …]}  逐日一条
//   GET /weapi/point/signed/get → {code:200,data:{days:0,shells:1}}
//   GET /weapi/point/today/get  → {code:200,data:{shells:0}}
//
// 注意:成长值**当天不涨**(实测签到前后都是 7527,昨日点数才是 6),所以它只用来呈现,
// 不能当「今天签成了」的判据;判据是签到动作自己的业务字段(见 src/vip.js)。

export const GROWTH_PATH = 'vipGrowthPoint'
export const TODAY_PATH = 'vipSignInfo'
export const YUNBEI_SIGNED_PATH = 'yunbeiSignedGet'
export const YUNBEI_TODAY_PATH = 'yunbeiTodayGet'

const numOrNull = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** 从成长值响应里读 `{level, growthPoint, yesterdayPoint}`;形状不认识时各字段为 null。 */
export function readGrowth(payload) {
  const level = payload?.data?.userLevel
  if (!level || typeof level !== 'object') return { level: null, growthPoint: null, yesterdayPoint: null }
  return {
    level: numOrNull(level.level),
    growthPoint: numOrNull(level.growthPoint),
    yesterdayPoint: numOrNull(level.yesterdayPoint),
  }
}

/** 从逐日记录里读「今天那一条」;找不到就返回 null。 */
export function readToday(payload, now = new Date()) {
  const list = payload?.data
  if (!Array.isArray(list)) return null
  const todayText = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const hit = list.find((item) => item?.today === true) ?? list.find((item) => item?.timeStr === todayText)
  if (!hit) return null
  return { timeStr: typeof hit.timeStr === 'string' ? hit.timeStr : null, score: numOrNull(hit.score) }
}

/** 云贝:`/point/signed/get` 给连续天数与本次获得的贝壳,`/point/today/get` 给今日所得。 */
export function readYunbei(signedPayload, todayPayload) {
  const signed = signedPayload?.data
  const today = todayPayload?.data
  return {
    days: numOrNull(signed?.days),
    shells: numOrNull(signed?.shells),
    todayShells: numOrNull(today?.shells),
  }
}
