// 只读体检:VIP 状态 + 成长值 + 云贝计数。check 与 probe 共用,全程不写状态、不重试。
// 从 cli.js 拆出来只为守住单文件 200 行上限(A17);判定口径不在这里另立标准。
import { pace } from './pacing.js'
import { call } from './client.js'
import { PATHS } from './crypto.js'
import { readGrowth, readToday } from './fields.js'
import { queryYunbei, renderYunbeiLine } from './yunbei.js'

/**
 * 只读体检时呈现 VIP 状态:真机实测「今天签没签」没有布尔字段,只有逐日记录里今天那一条
 * (timeStr / score)与成长值。所以这里只说读到的事实,不下「已签/未签」的断言 ——
 * 那要靠签到动作的业务字段(见 src/vip.js),探针阶段不该给结论。
 */
export const vipWord = (infoBody) => {
  const today = readToday(infoBody)
  if (!today) return 'VIP 状态:今天还没有记录'
  const score = today.score === null ? '分数未知' : `分 ${today.score}`
  return `VIP 状态:今天有记录 · ${score}`
}

/**
 * 逐账号只读:VIP 状态读回 + 云贝查询。check 与 probe 共用,全程不写状态、不重试。
 * verbose 时逐接口打印「接口 · 加密层 · code · reason」,给 T3 探针留实测记录。
 */
export async function readAccounts({ config, deps, log, verbose }) {
  let allOk = true
  for (const [index, account] of config.accounts.entries()) {
    if (index > 0) await pace(deps)
    const status = await call({ url: PATHS.vipSignInfo, crypto: 'weapi', data: {}, cookie: account.cookie, deps })
    if (verbose) log(`  ${PATHS.vipSignInfo} · weapi · code ${status.code ?? '无'} · ${status.reason}`)
    await pace(deps)
    const growth = await call({ url: PATHS.vipGrowthPoint, crypto: 'weapi', data: {}, cookie: account.cookie, deps })
    if (verbose) log(`  ${PATHS.vipGrowthPoint} · weapi · code ${growth.code ?? '无'} · ${growth.reason}`)
    await pace(deps)
    const yunbei = await queryYunbei({ cookie: account.cookie, deps })
    const signed = yunbei.raw?.signed
    if (verbose) log(`  ${PATHS.yunbeiSignedGet} · weapi · code ${signed?.code ?? '无'} · ${signed?.reason}`)
    const ok = status.ok === true && growth.ok === true && yunbei.ok === true
    if (!ok) allOk = false
    const g = readGrowth(growth.body)
    const growthText = g.growthPoint === null ? '成长值未知' : `成长值 ${g.growthPoint} · 昨日 +${g.yesterdayPoint ?? 0}`
    log(`${account.name} · ${vipWord(status.body)} · ${growthText} · ${renderYunbeiLine(yunbei)} · ${ok ? '可用' : '有失败'}`)
  }
  return allOk
}

