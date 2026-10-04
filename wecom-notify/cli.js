#!/usr/bin/env node
// 企业微信群机器人通知 CLI。
import fs from 'node:fs'

import { sendWecom } from './src/wecom.js'
import { maskWebhook, resolveWebhook } from './src/webhook.js'

const HELP = `wecom-notify - 企业微信群机器人通知

用法:
  wecom-notify "消息内容"                 发送文本
  wecom-notify --stdin                    从标准输入读取内容
  wecom-notify --file logs/last.log       发送文件内容(超长自动截断)
  wecom-notify --markdown "**粗体**"      以 markdown 发送
  wecom-notify --check                    发送一条配置校验消息
  wecom-notify --dry-run "内容"           只打印将发送的内容,不请求网络

配置(优先级从高到低):
  --webhook <url>        直接给地址
  WECOM_WEBHOOK_URL      环境变量
  --webhook-file <path>  指定文件(默认 ./wecom-webhook.txt)
  WECOM_WEBHOOK_FILE     环境变量指定文件

退出码: 0 成功 | 1 发送失败 | 2 用法或配置错误
`

function parseArgs(argv) {
    const flags = { msgtype: 'text' }
    const rest = []

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        const value = () => argv[++i]

        switch (arg) {
            case '--webhook':
                flags.url = value()
                break
            case '--webhook-file':
                flags.file = value()
                break
            case '--file':
                flags.inputFile = value()
                break
            case '--stdin':
                flags.stdin = true
                break
            case '--markdown':
                flags.msgtype = 'markdown'
                break
            case '--check':
                flags.check = true
                break
            case '--dry-run':
                flags.dryRun = true
                break
            case '-h':
            case '--help':
                flags.help = true
                break
            default:
                rest.push(arg)
        }
    }

    flags.text = rest.join(' ').trim()
    return flags
}

function readStdin() {
    return new Promise(resolve => {
        let data = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', chunk => (data += chunk))
        process.stdin.on('end', () => resolve(data))
    })
}

async function resolveText(flags) {
    if (flags.check) return `[wecom-notify] 配置校验:${new Date().toLocaleString()}`
    if (flags.inputFile) return fs.readFileSync(flags.inputFile, 'utf8')
    if (flags.stdin) return await readStdin()
    return flags.text
}

async function main() {
    const flags = parseArgs(process.argv.slice(2))

    if (flags.help) {
        process.stdout.write(HELP)
        return
    }

    const text = (await resolveText(flags)).trim()
    if (!text) {
        process.stderr.write('没有可发送的内容;用 --help 查看用法\n')
        process.exitCode = 2
        return
    }

    let webhook = null
    try {
        webhook = resolveWebhook({ url: flags.url, file: flags.file })
    } catch (error) {
        if (!flags.dryRun) {
            process.stderr.write(`${error.message}\n`)
            process.exitCode = 2
            return
        }
    }

    if (webhook) {
        process.stdout.write(`webhook 来源: ${webhook.source} | ${maskWebhook(webhook.url)}\n`)
    } else if (flags.dryRun) {
        process.stdout.write('webhook 来源: (未配置,dry-run 不请求网络)\n')
    }
    if (flags.dryRun) {
        process.stdout.write(`[dry-run] msgtype=${flags.msgtype} 内容如下:\n${text}\n`)
        return
    }

    try {
        await sendWecom(text, {
            webhookUrl: webhook.url,
            msgtype: flags.msgtype,
            onRetry: (error, attempt) => process.stderr.write(`第 ${attempt} 次重试(原因:${error.message})\n`)
        })
        process.stdout.write('发送成功\n')
    } catch (error) {
        process.stderr.write(`发送失败:${error.message}\n`)
        process.exitCode = 1
    }
}

main().catch(error => {
    process.stderr.write(`异常:${error?.message ?? error}\n`)
    process.exitCode = 1
})
