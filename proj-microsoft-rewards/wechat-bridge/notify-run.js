// 从运行日志构建并推送本次结果通知(排版在 lib/report.js)。
//
// 用法: node wechat-bridge/notify-run.js ["logs/last-run.log"] [--dry]
// --dry:只预览文案,不入库、不发送 —— 排查"推送里数字看不懂"时用。
import fs from 'node:fs'

import { broadcast, channelStatus } from './lib/channels.js'
import { recordRun, writeLastRun } from './lib/history.js'
import { buildSummary } from './lib/report.js'

// 既有测试与调用方从 notify-run.js 取 buildSummary,这里保持原路径可用
export { buildSummary }

async function main() {
    const args = process.argv.slice(2)
    const dry = args.includes('--dry')
    const file = args.find(arg => !arg.startsWith('--')) ?? 'logs/last-run.log'
    if (!fs.existsSync(file)) {
        console.error(`找不到日志文件: ${file}`)
        process.exitCode = 2
        return
    }

    const status = channelStatus()
    console.log(`通道状态: 企业微信=${status.wecom ? '已配置' : '未配置'}`)

    const { text, history, marker } = buildSummary(fs.readFileSync(file, 'utf8').split(/\r?\n/))
    if (!text) {
        console.log('没有需要推送的内容')
        return
    }

    if (dry) {
        console.log('--- 预览(未发送)---')
        console.log(text)
        return
    }

    if (history.length) recordRun(history)
    // 落盘本次结果,供下一次开始消息的「上次」块使用
    if (marker) writeLastRun(marker)
    for (const line of await broadcast(text)) console.log(line)
}

if (process.argv[1]?.endsWith('notify-run.js')) {
    main().catch(error => {
        console.error(`推送失败:${error?.message ?? error}`)
        process.exitCode = 1
    })
}
