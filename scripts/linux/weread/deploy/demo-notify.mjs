// 一次性演示:把微信读书会发的每一种消息都真发一遍(每条都带【测试】前缀)。
// 跑法(容器里,因为要用容器内的 src 与 secrets):
//   docker compose -f /srv/apps/automation/compose.yaml run --rm -T \
//     --entrypoint node weread-run /opt/deploy/demo-notify.mjs
//
// 覆盖:开始自动阅读 / 运行成功 / 运行有失败 / 需要你处理。
import fs from 'node:fs'

import { sendWecom } from '/opt/weread/src/notify.js'
import { buildReport } from '/opt/weread/src/notify.js'
import { buildSkipMessage, buildStartMessage } from '/opt/weread/src/notify-policy.js'

const date = new Date().toLocaleDateString('sv-SE')   // YYYY-MM-DD(本地时区)
const TAG = '【测试】消息类型演示'
const accountName = '示例账号'   // 占位符:这个文件会进公开仓库,不放真实昵称
const webhookFile = '/opt/weread/secrets/wecom-webhook.txt'

// 字段照 src/notify.js 真正会读的来(plan.* / config.*),少一个就会抛错
const plan = {
    todayMinutes: 60, targetMinutes: 60, sections: [], runMinutes: 0,
    failableDays: 1, minutesSoFar: 347, remainingDays: 27, validDaysSoFar: 4,
    validNeeded: 29, emergency: false, windowAssumed: false
}
const config = {
    requiredMinutes: 1800, requiredValidDays: 29, windowAssumed: false,
    quietStart: '20:00', quietEnd: '23:00'
}
const challenge = { ok: true, list: [] }   // 接口正常但没有进行中的挑战 → 只报一行

const send = async (label, text) => {
    const result = await sendWecom(`${TAG} · ${label}\n\n${text}`, { webhookFile })
    console.log(`${label}: ${result.ok ? '已发送' : `失败(${result.error})`}`)
}

const texts = {}
texts['开始自动阅读'] = buildStartMessage({ date, accountName })
texts['运行成功'] = buildReport({
    date, accountName, plan, config,
    run: { ok: true, minutes: 60, renewal: '凭据已续期 wr_skey', alert: null },
    data: {
        welfare: { ok: true, claimed: false, reason: 'no-coin' },
        weekly: { ok: true, readingDays: 5, claimable: 0, claimed: [], alreadyClaimed: [], failed: [] },
        challenge,
        balance: null,
        memberCard: null
    }
})

texts['运行有失败'] = buildReport({
    date, accountName, plan, config,
    run: { ok: false, minutes: 12, renewal: null, alert: '读回校验失败:官方统计里没有本次分钟数' },
    data: {
        welfare: { ok: false, reason: 'query-failed' },
        weekly: { ok: false, reason: 'query-failed' },
        challenge,
        balance: null,
        memberCard: null
    }
})

texts['需要你处理'] = buildSkipMessage({ reason: 'credential-invalid', detail: 'HTTP 401', plan, config, date, accountName })

for (const [label, text] of Object.entries(texts)) await send(label, text)
