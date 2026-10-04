// 一次性演示:把微软积分会发的每一种消息都真发一遍(每条都带【测试】前缀,便于辨认)。
// 跑法(服务器上,宿主 node 直接跑):
//   cd /srv/apps/automation/rewards && node wechat-bridge/demo-notify.mjs
//
// 覆盖:开始运行 / 运行成功 / 运行有失败 / 需要你处理。
// 不写 history、不改状态文件 —— 只发消息。
import fs from 'node:fs'

import { broadcast } from './lib/channels.js'
import { buildSummary } from './lib/report.js'
import { buildStartMessage } from './lib/start.js'
import { buildSkipMessage } from './lib/skip.js'
import { localDay } from './lib/report.js'

const day = localDay(new Date())
const accounts = (fs.readFileSync('.env', 'utf8').match(/^ACCOUNT_\d+_EMAIL=/gm) ?? []).length
const TAG = '【测试】消息类型演示'

const send = async (label, text) => {
    const results = await broadcast(`${TAG} · ${label}\n\n${text}`)
    console.log(`${label}: ${results.join(' / ')}`)
}

// 1) 开始运行
await send('开始运行', buildStartMessage({ day, accounts, retry: false }))

// 2) 运行成功(用今天真实日志)
const ok = buildSummary(fs.readFileSync('logs/last-run.log', 'utf8').split(/\r?\n/))
await send('运行成功', ok.text ?? '(今天日志里没有可汇报的结果)')

// 3) 运行有失败(构造一份失败日志,只为演示样式)
const failLines = [
    `[${day} 08:00:00] === run start, attempt 1 of max 3 today ===`,
    `[${day} 08:12:31] [ACCOUNT-ERROR] flow failed for demo@example.com: login rejected`,
    `[${day} 08:12:31] [ACCOUNT-END] Completed account: ok@example.com`,
    `[${day} 08:20:05] [WATCHDOG] run killed after 150 minutes`,
    `[${day} 08:20:05] === run finished with FAILURES, exit code 1 ===`
]
const bad = buildSummary(failLines)
await send('运行有失败', bad.text ?? '(构造的失败日志没有产出文案)')

// 4) 需要你处理(唯一还会推送的跳过类)
await send('需要你处理', buildSkipMessage({ mode: 'nocreds' }))
