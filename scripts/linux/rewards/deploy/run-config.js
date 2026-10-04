// 运行器辅助(Linux 版):按可用内存决定"跑不跑 / 并行几个集群",必要时写进 config/config.json。
//
//   node deploy/run-config.js decide          -> 2 | 1 | SKIP
//   node deploy/run-config.js clusters auto   -> 按内存自动选并写入 config/config.json
//   node deploy/run-config.js show            -> 输出当前值
//
// 与 Windows 版 scripts/windows/run-config.js 同一套阈值,只有两点不同:
//   1. 配置路径来自环境变量 REWARDS_CONFIG(默认 <套件>/rewards/config/config.json)
//   2. 云主机是独占的 2C4G,没有"内存被别的程序占满"那回事,所以调用方
//      (rewards/run.sh)把 REWARDS_FREE_MB_FOR_PARALLEL 调到 1800 —— 实测可用内存
//      常在 2.3GB 左右,按上游默认 2500 会一直只开单集群,白白多花一倍时间。
import fs from 'node:fs'
import os from 'node:os'

const CONFIG = process.env.REWARDS_CONFIG ?? '/srv/apps/automation/rewards/config/config.json'
const FREE_MB_FOR_PARALLEL = Number(process.env.REWARDS_FREE_MB_FOR_PARALLEL ?? 2500)
const MIN_FREE_MB = Number(process.env.REWARDS_MIN_FREE_MB ?? 1200)

function readConfig() {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
}

function writeConfig(config) {
    const tmp = `${CONFIG}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 4)}\n`, 'utf8')
    fs.renameSync(tmp, CONFIG)
}

const freeMemoryMb = () => Math.round(os.freemem() / (1024 * 1024))

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
