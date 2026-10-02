// "本次触发被跳过"的通知:由 run-daily.bat 调用。
//
// 用法:
//   node wechat-bridge/notify-skip.js memory <可用内存MB>      内存不足,跳过启动
//   node wechat-bridge/notify-skip.js handled <逻辑日>         当天已经跑过,跳过本次触发
//
// 为什么要有这个文件:
// 1) 提示文字必须写在 JS 里。批处理文件是 UTF-8,而 cmd 按 GBK 解析中文参数 ——
//    实测多字节字的尾字节会吃掉参数末尾的引号,连重定向都会被吞进参数里
//    (2026-09-23 踩过),所以 bat 里只传数字和 ASCII 词。
// 2) "开机后迟迟不启动"曾经是因为跳过时**一声不响**:2026-09-24 开机后 11:33/11:34/12:00
//    三次触发都被"一天只跑一遍"规则拦下,用户什么都没收到,只能自己猜。
import { broadcast, channelStatus } from './lib/channels.js'
import { readHistory } from './lib/history.js'

const pad = value => String(value).padStart(2, '0')

function localStamp(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function localDay(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

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

function memoryMessage(freeMb) {
    return [
        `[Microsoft Rewards] ${localStamp(new Date())} 内存不足,本次运行已跳过`,
        `可用内存 ${freeMb}MB,低于启动门槛,硬跑只会拖成几小时`,
        '等内存空出来后的下一次触发会自动补跑(不消耗当天的尝试次数)'
    ]
}

function handledMessage(day) {
    const gained = gainedOn(day)
    const today = localDay(new Date())
    const sameDay = day === today
    return [
        `[Microsoft Rewards] ${localStamp(new Date())} 本次触发已跳过:${sameDay ? '今天' : day}已经跑过`,
        gained > 0 ? `已入账 +${gained} 分,重复运行不会再有新分` : '当天的积分已经领取过,重复运行不会再有新分',
        '这是正常行为(一天只跑一遍);下一次自动运行照旧,不需要人工处理'
    ]
}

async function main() {
    // --dry:只预览文案,不真的发送
    const dryRun = process.argv.includes('--dry')
    const mode = (process.argv[2] ?? 'memory').toLowerCase()

    const status = channelStatus()
    if (!status.wecom) {
        console.log('未配置通知通道,跳过提醒')
        return
    }

    // 位置参数里排除 --dry 这类开关
    const positional = process.argv.slice(3).filter(arg => !arg.startsWith('--'))
    const lines =
        mode === 'handled'
            ? handledMessage(positional[0]?.trim() || localDay(new Date()))
            : memoryMessage(positional[0]?.trim() || '未知')

    if (dryRun) console.log(lines.join(String.fromCharCode(10)))
    for (const line of await broadcast(lines.join(String.fromCharCode(10)), { dryRun })) console.log(line)
}

main().catch(error => {
    console.error(`跳过提醒发送失败:${error?.message ?? error}`)
    process.exitCode = 1
})
