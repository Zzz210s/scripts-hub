// 「需要你处理」的通知:由运行器调用。
//
// 用法:
//   node wechat-bridge/notify-skip.js nocreds    .env 里没有真实账号 —— 唯一还会推送的一类
//
// 2026-10-04 用户要求:企业微信不再接收「正常跳过」消息。因此 memory / handled / exhausted
// 三种调用只剩日志意义 —— 传进来会直接打印一行"不推送"并返回,不再生成任何文案。
// 运行器(run.sh / run-daily.bat)对这三种情形只写 runner.log。
//
// 为什么提示文字写在 JS 里:批处理是 UTF-8 而 cmd 按 GBK 解析中文参数,实测多字节字的尾字节
// 会吃掉参数末尾的引号(2026-09-23 踩过),所以 bat 只传数字与 ASCII 词。
import { broadcast, channelStatus } from './lib/channels.js'
import { buildSkipMessage, isSilentSkip } from './lib/skip.js'

const MODES = ['memory', 'handled', 'exhausted', 'nocreds']

async function main() {
    const dryRun = process.argv.includes('--dry')
    const mode = (process.argv[2] ?? 'nocreds').toLowerCase()

    if (!MODES.includes(mode)) console.error(`未知的跳过原因: ${mode},按不需要处理处理`)
    if (isSilentSkip(mode)) {
        console.log(`正常跳过,不推送(只写运行日志):${mode}`)
        return
    }

    const text = buildSkipMessage({ mode })
    if (dryRun) console.log(text)
    if (!channelStatus().wecom) {
        console.log('未配置通知通道,跳过提醒')
        return
    }
    for (const line of await broadcast(text, { dryRun })) console.log(line)
}

main().catch(error => {
    console.error(`提醒发送失败:${error?.message ?? error}`)
    process.exitCode = 1
})
