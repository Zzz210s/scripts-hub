// 命令行入口。只做参数解析与 IO 组装;判定逻辑在 run.js / guards.js / state.js 里(可测)。
//
//   node src/cli.js run [--dry-run]   探测 + 按需领取(计划任务入口)
//   node src/cli.js probe             只看当期与预告的免费游戏
//   node src/cli.js status            本地状态与今日尝试次数
//   node src/cli.js link <slug|序号>  打印预置结账链接(退化路径手动用)
//   node src/cli.js login             跑一次引擎并放宽登录等待,供人工登录一次
//   node src/cli.js pause / resume    暂停 / 恢复无人值守运行
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from './config.js'
import { cycleFor, dayKey, formatLocal, isHolidaySale } from './clock.js'
import { checkoutUrl, storeUrl } from './promo.js'
import { probe } from './probe.js'
import { readVendorDb, runEpicEngine } from './engine.js'
import { loadState, saveState, setPaused, attemptsToday, gameStatus } from './state.js'
import { peerRunning } from './lock.js'
import { sendWecom } from './notify.js'
import { runOnce } from './run.js'

const args = process.argv.slice(2)
const command = args.find((a) => !a.startsWith('-')) ?? 'run'
const flag = (name) => args.includes(name)
const config = loadConfig({ ...process.env, EPIC_DRY_RUN: flag('--dry-run') ? '1' : process.env.EPIC_DRY_RUN })

const log = (line) => process.stdout.write(`${line}\n`)
const fail = (line) => process.stderr.write(`${line}\n`)

const formatWindow = (game) => `${formatLocal(game.startAt)} - ${formatLocal(game.endAt)}`

async function printProbe() {
    const result = await probe({ config })
    if (!result.ok) {
        fail(`[失败] 读免费清单失败:${result.error}`)
        return 1
    }
    const cycle = cycleFor(new Date())
    log(`周期:${formatLocal(cycle.start)} - ${formatLocal(cycle.end)}${isHolidaySale(new Date()) ? ' · Holiday Sale 期间' : ''}`)
    log(`当期免费 ${result.current.length} 个`)
    result.current.forEach((game, i) => log(`  ${i + 1}. ${game.title} · ${formatWindow(game)} · ${storeUrl(game.slug)}`))
    log(`预告 ${result.upcoming.length} 个`)
    result.upcoming.forEach((game) => log(`  - ${game.title} · ${formatWindow(game)}`))
    return 0
}

function printStatus() {
    const now = new Date()
    const { state, warnings } = loadState(config.stateFile)
    for (const warning of warnings) fail(`[警告] ${warning}`)
    log(`状态文件:${config.stateFile}`)
    log(`账号:${state.account || '未记录'} · 暂停:${state.paused ? '是' : '否'} · 今日尝试:${attemptsToday(state, now)}/${config.maxAttemptsPerDay}`)
    const games = Object.entries(state.games ?? {})
    log(`已记录 ${games.length} 款游戏`)
    for (const [slug, entry] of games.slice(-10)) log(`  ${entry.status ?? '?'} ${entry.title} · ${slug}`)
    return 0
}

async function printLink(query) {
    const { state } = loadState(config.stateFile)
    const known = Object.entries(state.games ?? {}).map(([slug, entry]) => ({ slug, ...entry }))
    let game = known.find((entry) => entry.slug === query)
    if (!game) {
        const result = await probe({ config })
        if (!result.ok) {
            fail(`[失败] 本地没有 ${query},读免费清单也失败:${result.error}`)
            return 1
        }
        const index = Number(query)
        game = Number.isInteger(index) && index >= 1 ? result.current[index - 1] : result.current.find((item) => item.slug === query || item.title.includes(query))
    }
    if (!game) {
        fail(`[失败] 找不到游戏:${query}(用 node src/cli.js probe 看当期清单)`)
        return 1
    }
    log(game.title ?? game.slug)
    log(`结账链接:${checkoutUrl(game)}`)
    log(`商店页:${storeUrl(game.slug)}`)
    return 0
}

async function main() {
    switch (command) {
        case 'probe':
            return printProbe()
        case 'status':
            return printStatus()
        case 'link':
            return printLink(args.filter((a) => !a.startsWith('-'))[1] ?? '')
        case 'pause':
        case 'resume': {
            const { state } = loadState(config.stateFile)
            setPaused(state, command === 'pause')
            saveState(config.stateFile, state)
            log(`已${command === 'pause' ? '暂停' : '恢复'}:${config.stateFile}`)
            return 0
        }
        case 'login': {
            log('打开浏览器让你登录一次;登录态落在持久化 profile 里,不保存密码。')
            const run = await runEpicEngine({ config, env: { NOWAIT: '', LOGIN_TIMEOUT: '600' }, log })
            return run.code === 0 ? 0 : 1
        }
        case 'report': {
            const { state } = loadState(config.stateFile)
            log(`Epic 限免 · ${state.account || '1 个账号'} · ${dayKey(new Date())} · 状态摘要`)
            for (const [slug, entry] of Object.entries(state.games ?? {})) log(`${entry.status ?? '?'} ${entry.title} · ${slug}`)
            return 0
        }
        case 'run': {
            const result = await runOnce({
                config,
                now: new Date(),
                deps: {
                    log: (line) => process.stdout.write(`${line}\n`),
                    probe,
                    runEngine: runEpicEngine,
                    readDb: readVendorDb,
                    freeMb: () => Math.round(os.freemem() / 1048576),
                    peerRunning: () => peerRunning(config.busyPeers),
                    send: async (text) => {
                        const sent = await sendWecom(text, { webhookFile: config.webhookFile })
                        if (!sent.ok) fail(`[通知失败] ${sent.error}`)
                        return sent
                    }
                }
            })
            if (result.dryRun) {
                log(result.planned.length ? result.planned.join('\n---\n') : '[dry-run] 本地守卫会跳过,无消息')
                return 0
            }
            return result.code
        }
        default:
            fail('用法:node src/cli.js run|probe|status|link <slug|序号>|login|report|pause|resume [--dry-run]')
            return 2
    }
}

main().then((code) => {
    process.exitCode = code
}).catch((error) => {
    fail(`[错误] ${error?.message ?? error}`)
    process.exitCode = 1
})
