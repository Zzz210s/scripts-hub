// 运行器辅助:按可用内存决定"跑不跑 / 并行几个集群",必要时写进 config.json。
//
//   node scripts\windows\run-config.js decide           -> 2 | 1 | SKIP(内存不够就不启动)
//   node scripts\windows\run-config.js clusters auto    -> 按内存自动选并写入 config.json
//   node scripts\windows\run-config.js clusters 1       -> 强制设为 1
//   node scripts\windows\run-config.js show             -> 输出当前值
//
// 阈值(可用环境变量覆盖):
//   REWARDS_FREE_MB_FOR_PARALLEL(默认 2500)—— 高于它才敢开两个集群
//   REWARDS_MIN_FREE_MB(默认 1200)—— 低于它就不启动,把机会留给后面的触发
//
// 为什么要它:上游脚本每个账号会开"移动 + 桌面"两个 headless Chromium,
// clusters=2 时同时有 4 个浏览器。本机内存常被其它程序占满(实测提交内存可到
// 物理内存的两倍以上,大量换页),此时并行只会互相拖慢:整次运行从 30 多分钟
// 拖到几小时,还会出现十几分钟的静默卡死。
//
// 注意:CONFIG_CLUSTERS 那套环境变量覆盖在本版本里是死代码(ENV_OVERRIDES 没有
// 任何调用点),所以只能改 config.json —— 写入用临时文件 + 改名,避免写坏配置。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONFIG = path.join(root, 'config.json')

/** 可用内存高于这个值才敢开两个集群。 */
const FREE_MB_FOR_PARALLEL = Number(process.env.REWARDS_FREE_MB_FOR_PARALLEL ?? 2500)
/** 低于这个值就不启动(一次运行自己就要约 1 GB,再多就是跟换页抢时间)。 */
const MIN_FREE_MB = Number(process.env.REWARDS_MIN_FREE_MB ?? 1200)

function readConfig() {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
}

function writeConfig(config) {
    const tmp = `${CONFIG}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 4)}\n`, 'utf8')
    fs.renameSync(tmp, CONFIG)
}

function freeMemoryMb() {
    return Math.round(os.freemem() / (1024 * 1024))
}

const command = process.argv[2] ?? 'show'
const value = process.argv[3]

if (command === 'show') {
    process.stdout.write(`${readConfig().clusters}\n`)
} else if (command === 'decide') {
    const free = freeMemoryMb()
    process.stdout.write(`${free >= FREE_MB_FOR_PARALLEL ? '2' : free >= MIN_FREE_MB ? '1' : 'SKIP'}\n`)
} else if (command === 'clusters') {
    const target = value === undefined || value === 'auto' ? (freeMemoryMb() >= FREE_MB_FOR_PARALLEL ? 2 : 1) : Number(value)
    if (!Number.isInteger(target) || target < 1) {
        process.stderr.write('用法: run-config.js clusters [auto|>=1 的整数]\n')
        process.exitCode = 2
    } else {
        const config = readConfig()
        if (config.clusters !== target) {
            config.clusters = target
            writeConfig(config)
        }
        process.stdout.write(`${target}\n`)
    }
} else {
    process.stderr.write('用法: run-config.js [show|decide|clusters auto|clusters N]\n')
    process.exitCode = 2
}
