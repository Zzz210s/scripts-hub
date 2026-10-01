// 手动推一条通知(默认企业微信群机器人通道)。
// Usage: node wechat-bridge/push.js "text"
//        echo text | node wechat-bridge/push.js
import { broadcast, channelStatus } from './lib/channels.js'

function readStdin() {
    return new Promise(resolve => {
        let data = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', chunk => (data += chunk))
        process.stdin.on('end', () => resolve(data.trim()))
    })
}

async function main() {
    const inline = process.argv.slice(2).join(' ').trim()
    const text = inline || (await readStdin())

    if (!text) {
        console.error('没有可发送的内容;用法: node wechat-bridge/push.js "文本"')
        process.exitCode = 2
        return
    }

    const status = channelStatus()
    console.log(`通道状态: 企业微信=${status.wecom ? '已配置' : '未配置'}`)

    const results = await broadcast(text)
    for (const line of results) console.log(line)
    if (results.some(line => line.includes('失败'))) process.exitCode = 1
}

main().catch(error => {
    console.error(`推送失败:${error?.message ?? error}`)
    process.exitCode = 1
})
