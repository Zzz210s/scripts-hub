// 某一天的汇总通知(把当天多次运行合并成一条)。
//
// 用法:
//   node wechat-bridge/notify-day.js            -> 汇总"今天"(本地日期)
//   node wechat-bridge/notify-day.js 2026-09-25 -> 汇总指定日期
//   node wechat-bridge/notify-day.js --dry      -> 只预览,不发送
//
// 为什么需要它:一天可能跑不止一次(某账号瞬时失败后当天补跑),只推送单次运行的
// 数字会让人以为"今天有账号得了 0 分"(2026-09-25 用户就是这么问的)。这里按积分历史
// 把当天所有运行合并,逐账号给出"今日 +X 分 | 累计 Y 分"。
import { broadcast, channelStatus } from './lib/channels.js'
import { readHistory } from './lib/history.js'

const pad = value => String(value).padStart(2, '0')

function localDay(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 同一次运行的多条记录共享同一个 at 时间戳,据此数出当天跑了几次。 */
function countRuns(records) {
    return new Set(records.map(entry => entry.at).filter(Boolean)).size || (records.length ? 1 : 0)
}

export function buildDaySummary(day, records) {
    if (!records.length) {
        return `[Microsoft Rewards] ${day} 没有积分记录(当天可能未运行)`
    }

    // 去重:同一份运行结果可能被重复写入(见 notify-run.js 的同款处理)。
    const seen = new Set()
    const unique = records.filter(entry => {
        const key = `${entry.account}|${entry.before}|${entry.balance}|${entry.gained}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })

    const perAccount = new Map()
    for (const entry of unique) {
        const current = perAccount.get(entry.account) ?? { account: entry.account, gained: 0, balance: entry.balance }
        current.gained += Number(entry.gained) || 0
        current.balance = entry.balance
        perAccount.set(entry.account, current)
    }

    const rows = [...perAccount.values()].map(
        entry => `账号 ${entry.account}: 今日 +${entry.gained} 分 | 累计 ${entry.balance} 分`
    )
    const total = [...perAccount.values()].reduce((sum, entry) => sum + entry.gained, 0)
    const runs = countRuns(unique)
    const zero = [...perAccount.values()].filter(entry => entry.gained === 0).length

    const lines = [
        `[Microsoft Rewards] ${day} 今日汇总(${perAccount.size} 个账号${runs > 1 ? `,${runs} 次运行合并` : ''})`,
        ...rows,
        `今日共 +${total} 分`
    ]
    if (zero && runs > 1) lines.push(`其中有 ${zero} 个账号当天不再有新分(当天早些的运行已领完)`)
    return lines.join('\n')
}

async function main() {
    const args = process.argv.slice(2)
    const dry = args.includes('--dry')
    const day = args.find(arg => !arg.startsWith('--')) ?? localDay(new Date())

    const records = readHistory().filter(entry => entry.day === day)
    const text = buildDaySummary(day, records)

    const status = channelStatus()
    console.log(`通道状态: 企业微信=${status.wecom ? '已配置' : '未配置'} | 日期=${day} | 记录 ${records.length} 条`)

    if (dry) {
        console.log('--- 预览(未发送)---')
        console.log(text)
        return
    }

    for (const line of await broadcast(text)) console.log(line)
}

if (process.argv[1]?.endsWith('notify-day.js')) {
    main().catch(error => {
        console.error(`汇总通知失败:${error?.message ?? error}`)
        process.exitCode = 1
    })
}
