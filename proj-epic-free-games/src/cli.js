// 命令行入口。只做参数解析与 IO 组装;判定逻辑在 run.js / guards.js / state.js 里(可测)。
//
//   node src/cli.js run [--dry-run]   探测 + 按需领取(计划任务入口)
//   node src/cli.js probe             只看当期与预告的免费游戏
//   node src/cli.js status            本地状态与今日尝试次数
//   node src/cli.js link <slug|序号>  打印预置结账链接(退化路径手动用)
//   node src/cli.js login             设备授权登录一次,之后自动续期
//   node src/cli.js login --browser   退路:开浏览器人工登录一次(落 profile)
//   node src/cli.js auth              看 token 状态与到期时间
//   node src/cli.js pause / resume    暂停 / 恢复无人值守运行
import fs from 'node:fs'
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
import { ensureSession } from './auth.js'
import { deviceLogin, profileLogin } from './login.js'
import { loadTokens, tokenSummary } from './tokens.js'

const args = process.argv.slice(2)
const command = args.find((a) => !a.startsWith('-')) ?? 'run'
const flag = (name) => args.includes(name)
const config = loadConfig({ ...process.env, EPIC_DRY_RUN: flag('--dry-run') ? '1' : process.env.EPIC_DRY_RUN })

const log = (line) => process.stdout.write(`${line}\n`)
const fail = (line) => process.stderr.write(`${line}\n`)

// 所有路径都以项目根为基准(config.js 的 ROOT 取自 import.meta.dirname),
// 因此从任何目录执行 `node <这里>/src/cli.js ...` 结果一致。
const USAGE = `用法:node src/cli.js <命令> [选项]

  probe              只看当期与预告的免费游戏(不登录)
  status             本地状态与今日尝试次数
  link <slug|序号>   打印某款游戏的预置结账链接
  login [--browser]  设备授权登录一次(默认);--browser 走浏览器人工登录
  auth               看 token 状态与到期时间
  run [--dry-run]    探测 + 按需领取(计划任务入口)
  report             打印状态摘要
  pause | resume     暂停 / 恢复无人值守运行
  help               显示本帮助

  --dry-run          不联网、不起浏览器,只打印会发什么
  -h, --help         显示本帮助

从仓库外执行时用绝对路径,例如:
  node "$HOME/home-automation-configs/proj-epic-free-games/src/cli.js" status

Windows 快捷入口(自己 cd 到项目根):scripts/windows/epic-status.bat`

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

/**
 * 可用内存(MB)。
 *
 * 不能用 os.freemem():Linux 上它返回 MemFree,把可回收的页缓存也算作已用 ——
 * 实测同一时刻 MemFree 不到 800MB 而 MemAvailable 是 2.3GB,于是内存闸门会把可跑的情形
 * 判成「内存不足」跳过(Windows 上没这个问题)。优先读 /proc/meminfo 的 MemAvailable。
 */
function freeMemoryMb() {
    try {
        const m = /^MemAvailable:\s+(\d+) kB/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'))
        if (m) return Math.round(Number(m[1]) / 1024)
    } catch { /* 非 Linux 或读不到,走兜底 */ }
    return Math.round(os.freemem() / 1048576)
}

async function main() {
    if (flag('-h') || flag('--help')) {
        log(USAGE)
        return 0
    }
    switch (command) {
        case 'help':
            log(USAGE)
            return 0
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
            // 默认走设备授权:一次浏览器确认,之后靠 refresh_token 自动续期;
            // --browser 保留原来的浏览器 profile 登录作为退路。
            if (flag('--browser')) {
                const result = await profileLogin({ config, runEngine: runEpicEngine, log })
                return result.ok ? 0 : 1
            }
            const result = await deviceLogin({ config, log })
            if (!result.ok) fail(`[失败] ${result.error}`)
            return result.ok ? 0 : 1
        }
        case 'auth': {
            const { tokens, error } = loadTokens(config.tokensFile)
            if (error) {
                fail(`[失败] ${error}`)
                return 1
            }
            if (!tokens) {
                log(`没有 token 文件:${config.tokensFile}`)
                log('当前使用浏览器 profile 的登录态;要长期免登录,跑 node src/cli.js login')
                return 0
            }
            const summary = tokenSummary(tokens, new Date())
            log(`账号:${summary.account || '未知'}`)
            log(`access token:${summary.masked} · ${summary.accessValid ? '有效' : '已过期'} · 至 ${summary.accessExpiresAt || '未知'}`)
            log(`refresh token:${summary.hasRefresh ? '有' : '无'} · 至 ${summary.refreshExpiresAt || '未知'}`)
            return 0
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
                    freeMb: () => freeMemoryMb(),
                    peerRunning: () => peerRunning(config.busyPeers),
                    ensureSession,
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
            fail(USAGE)
            return 2
    }
}

main().then((code) => {
    process.exitCode = code
}).catch((error) => {
    fail(`[错误] ${error?.message ?? error}`)
    process.exitCode = 1
})
