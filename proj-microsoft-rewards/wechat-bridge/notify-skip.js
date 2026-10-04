// "本次触发没有运行"与"需要人工处理"的通知:由 run-daily.bat 调用。
//
// 用法:
//   node wechat-bridge/notify-skip.js memory <可用内存MB>   内存不足,正常跳过
//   node wechat-bridge/notify-skip.js handled <逻辑日>       当天已经跑过,正常跳过(只记日志,不推送)
//   node wechat-bridge/notify-skip.js exhausted <逻辑日>     尝试次数用尽,正常跳过(照旧推送)
//   node wechat-bridge/notify-skip.js nocreds               .env 里没有真实账号,需要你处理
//
// 为什么要有这个文件:
// 1) 提示文字必须写在 JS 里。批处理文件是 UTF-8,而 cmd 按 GBK 解析中文参数 ——
//    实测多字节字的尾字节会吃掉参数末尾的引号,连重定向都会被吞进参数里
//    (2026-09-23 踩过),所以 bat 里只传数字和 ASCII 词。
// 2) "开机后迟迟不启动"曾经是因为跳过时**一声不响**:2026-09-24 开机后 11:33/11:34/12:00
//    三次触发都被"一天只跑一遍"规则拦下,用户什么都没收到,只能自己猜。
//
// 文案在 lib/skip.js:skip 与 action 的标题与正文结构不同,不再长得一样。
import { broadcast, channelStatus } from './lib/channels.js'
import { readHistory } from './lib/history.js'
import { localDay } from './lib/report.js'
import { buildSkipMessage, isSilentSkip } from './lib/skip.js'

const MODES = ['memory', 'handled', 'exhausted', 'nocreds']

/** 当天各账号已入账的分数合计(来自积分历史,取不到就返回 0)。 */
function gainedOn(day) {
    try {
        return readHistory()
            .filter(entry => entry.day === day)
            .reduce((sum, entry) => sum + (Number(entry.gained) || 0), 0)
    } catch {
        return 0
    }
}

async function main() {
    const dryRun = process.argv.includes('--dry')
    const positional = process.argv.slice(3).filter(arg => !arg.startsWith('--'))
    const mode = (process.argv[2] ?? 'memory').toLowerCase()
    const known = MODES.includes(mode)
    const needsDay = mode === 'handled' || mode === 'exhausted'
    const fallback = needsDay ? localDay(new Date()) : mode === 'nocreds' ? null : '未知'
    const arg = positional[0]?.trim() || fallback

    const today = localDay(new Date())
    const text = buildSkipMessage({
        mode: known ? mode : 'memory',
        arg,
        gained: needsDay ? gainedOn(arg) : 0,
        sameDay: mode === 'handled' ? arg === today : true
    })
    if (dryRun) console.log(text)

    // 正常跳过(handled)只写运行日志:静音不等于消失,整条文案留在 runner.log 里。
    // 放在通道检查之前 —— 没配 webhook 时也要能事后查到「今天为什么没跑」。
    if (isSilentSkip(mode)) {
        console.log('已静音:正常跳过不推送,只写运行日志')
        return
    }

    if (!channelStatus().wecom) {
        console.log('未配置通知通道,跳过提醒')
        return
    }

    // 未知 mode 也按 memory 文案发出,但先提示一下,免得静默发错类别
    if (!known) console.error(`未知的跳过原因: ${mode},已按内存不足处理`)
    for (const line of await broadcast(text, { dryRun })) console.log(line)
}

main().catch(error => {
    console.error(`跳过提醒发送失败:${error?.message ?? error}`)
    process.exitCode = 1
})
