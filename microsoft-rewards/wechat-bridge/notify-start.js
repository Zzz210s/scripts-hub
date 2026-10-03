// 运行开始提醒:由 run-daily.bat 在真正执行奖励脚本之前调用(排版在 lib/start.js)。
// 消息只有一行:哪个程序开始跑;第几次尝试 / 并行度 / 触发方式 / 上次结果只进运行日志。
// 用法: node wechat-bridge/notify-start.js [--note "触发方式"] [--retry] [--day YYYY-MM-DD] [--dry]
// 注意:提示文字都写在这里(UTF-8),不要让 bat 传中文参数 ——
// 批处理文件是 UTF-8 而 cmd 按 GBK 解析,中文参数会变成乱码甚至吃掉引号。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { broadcast, channelStatus } from './lib/channels.js'
import { readLastRun } from './lib/history.js'
import { buildStartMessage, MAX_ATTEMPTS } from './lib/start.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ENV_FILE = path.join(root, '.env')
const STATE_FILE = path.join(root, 'logs', 'last-run.state')

const pad = value => String(value).padStart(2, '0')

function localDay(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 统计 .env 中已配置的账号数;只数数量,不读取或输出任何账号内容。 */
function countAccounts() {
    try {
        return fs
            .readFileSync(ENV_FILE, 'utf8')
            .split(/\r?\n/)
            .map(line => /^ACCOUNT_[0-9]+_EMAIL=(.+)$/.exec(line.trim())?.[1]?.trim())
            .filter(value => value && !value.includes('example.com')).length
    } catch {
        return 0
    }
}

/** 本次是当天第几次尝试:状态文件里同一天已记录过就 +1,否则为第 1 次。 */
function attemptNumber(day) {
    try {
        const [stateDay, stateN] = fs.readFileSync(STATE_FILE, 'utf8').trim().split(/\s+/)
        return stateDay === day ? Number(stateN) + 1 : 1
    } catch {
        return 1
    }
}

/** 本次并行几个账号(读 config.json;读不到就按 1 处理)。 */
function clusterCount() {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'))
        const value = Number(config.clusters)
        return Number.isInteger(value) && value > 0 ? value : 1
    } catch {
        return 1
    }
}

async function main() {
    const dryRun = process.argv.includes('--dry')
    const noteIndex = process.argv.indexOf('--note')
    const note = noteIndex >= 0 ? process.argv[noteIndex + 1]?.trim() : null
    const retry = process.argv.includes('--retry')
    // 逻辑日由运行器传入(--day):它与状态文件用的是同一个"一天",
    // 凌晨的补跑归前一天,否则这里会把"今天第几次尝试"算错。
    const dayIndex = process.argv.indexOf('--day')
    const providedDay = dayIndex >= 0 ? process.argv[dayIndex + 1]?.trim() : null

    if (!channelStatus().wecom) {
        console.log('未配置通知通道,跳过开始提醒')
        return
    }

    const day = providedDay || localDay(new Date())
    const attempt = Math.min(attemptNumber(day), MAX_ATTEMPTS)
    const accounts = countAccounts()
    const clusters = clusterCount()
    const lastRun = readLastRun()
    // 消息只有一行;第几次尝试 / 并行度 / 触发方式 / 上次结果只进运行日志(2026-10-03)
    const detail = [`第 ${attempt} 次尝试 · 当天最多 ${MAX_ATTEMPTS} 次`, `并行 ${clusters}`]
    if (note) detail.push(`触发 ${note}`)
    if (lastRun?.day) detail.push(`上次 ${lastRun.day} ${lastRun.status === 'failed' ? '运行有失败' : '运行成功'} · 当日 +${lastRun.dayGained ?? lastRun.gained ?? 0} 分`)
    console.log(`本次口径:${detail.join(' · ')}`)

    const text = buildStartMessage({ day, accounts, retry })

    if (dryRun) console.log(text)
    for (const line of await broadcast(text, { dryRun })) console.log(line)
}

main().catch(error => {
    console.error(`开始提醒发送失败:${error?.message ?? error}`)
    process.exitCode = 1
})
