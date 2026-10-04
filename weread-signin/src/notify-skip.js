// 跳过提醒的命令行入口(供 .bat 在 JS 守卫之前调用,例如内存不足)。
//
//   node src/notify-skip.js low-memory 812
//
// 与运行流程里的跳过提醒共用同一套文案与频率限制(同一天同一种原因最多一条);
// 正常跳过(已达标 / 同伴在跑 / 安静时段)只写运行日志,不推送。
import path from 'node:path'

import { ensureWindow, loadConfig } from './config.js'
import { sendWecom } from './notify.js'
import { buildSkipMessage, isSilentSkip, shouldNotifyOnce } from './notify-policy.js'
import { localDay } from './plan.js'
import { readState } from './state.js'

const cwd = process.cwd()
const reason = process.argv[2] ?? 'low-memory'
const detail = process.argv[3] ? `${process.argv[3]}MB` : undefined
const now = new Date()
const date = localDay(now)
const config = ensureWindow(loadConfig(path.join(cwd, '.env')), date)

if (isSilentSkip(reason)) {
    console.log(`正常跳过,不推送(只记日志):${reason}`)
    process.exit(0)
}

if (!shouldNotifyOnce(path.join(cwd, 'data'), reason, date)) {
    console.log(`今天已经提醒过「${reason}」,不再重复发送`)
    process.exit(0)
}

const state = readState(path.join(cwd, 'data'), now)
const plan = { todayMinutes: state.todayMinutes, targetMinutes: state.targetMinutes, sections: [] }
const text = buildSkipMessage({ reason, detail, plan, config, date, accountName: config.accountName })
const result = await sendWecom(text, { webhookFile: path.join(cwd, config.webhookFile) })
console.log(result.ok ? '跳过提醒已推送' : `跳过提醒发送失败:${result.error}`)
