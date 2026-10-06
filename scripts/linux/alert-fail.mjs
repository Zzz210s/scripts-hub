#!/usr/bin/env node
/**
 * 宿主侧"运行崩了、一条消息都没发出去"的兜底提醒。
 *
 * 为什么需要:程序崩溃时会死在发消息之前(2026-10-05 实测:微信读书因为 config.yaml
 * 的挂载方式报 EBUSY,1 秒内退出,企业微信里什么也没有 —— 人只能靠"今天没消息"猜)。
 * 运行器检测到「退出码非 0 且日志里根本没出现过企业微信」时调这个脚本,补一条提醒。
 *
 * 用法:node alert-fail.mjs <程序名> <原因> [日志文件]
 *   例:node alert-fail.mjs 微信读书签到 "退出码 1" /srv/apps/automation/weread/logs/last-run.log
 */
import fs from 'node:fs'

const [program = '自动化程序', reason = '未知', logFile] = process.argv.slice(2)
// 每个程序一条独立通道(2026-10-05 用户建了 epic 与 服务器 两个新群机器人)。
// 通道文件都在仓库之外、权限 600;文档只记路径不记 key。
const webhookFiles = {
    微软积分: '/srv/apps/automation/rewards/wechat-bridge/data/wecom-webhook.txt',
    微信读书签到: '/srv/apps/automation/weread/secrets/wecom-webhook.txt',
    'Epic 限免': '/srv/apps/automation/epic/secrets/wecom-webhook.txt',
    服务器: '/srv/apps/automation/secrets/wecom-server.txt'
}
const webhookFile = webhookFiles[program]

// logFile 可能被调用方传成非字符串(会触发 Node 的 DEP0187 警告),先收口
const logPath = typeof logFile === 'string' ? logFile : undefined
const logText = logPath && fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''
const tail = logText ? logText.trim().split(/\r?\n/).slice(-6).join('\n').slice(-600) : '(没有日志)'

// 程序已经跑完并自己报过结果时不要补发 —— 2026-10-06 实测:Epic 的 last-run.log 里没有
// "企业微信"字样(推送走子进程),调用方据此误判成"没发过消息",于是同一天连推两条。
if (logText.includes('[完成]')) {
    console.log(`${program}:日志里已有 [完成] 标记,程序自己报过结果,跳过兜底提醒`)
    process.exit(0)
}

const text = [
    `${program} · ${new Date().toLocaleDateString('sv-SE')} · 需要你处理`,
    '',
    `请你:看服务器上 ${logFile ?? '对应日志'} 的尾部,再跑一次确认`,
    `原因:运行在发出任何消息之前就退出了 · ${reason}`,
    '不处理的后果:今天这一次等于没跑,而且不会有任何推送 —— 这正是这条兜底提醒要补上的',
    '',
    '日志尾部:',
    tail
].join('\n')

if (!webhookFile || !fs.existsSync(webhookFile)) {
    console.error(`未找到 webhook 文件:${webhookFile ?? '(未知程序)'}`)
    process.exit(1)
}

const response = await fetch(webhookFile.startsWith('http') ? webhookFile : fs.readFileSync(webhookFile, 'utf8').trim(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: text } })
})
console.log(response.ok ? `${program}:兜底提醒已发送` : `${program}:兜底提醒发送失败(HTTP ${response.status})`)
process.exit(response.ok ? 0 : 1)
