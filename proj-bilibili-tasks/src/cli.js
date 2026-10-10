// 命令行入口。只做参数解析与 IO 组装;判定逻辑在 run.js / guards.js / state.js 里(可测)。
//
//   node src/cli.js run [--dry-run]   完整跑一次(计划任务入口)
//   node src/cli.js login             扫码登录一次
//   node src/cli.js status            本地状态
//   node src/cli.js cookies           账号与条数,绝不打印 cookie 值
//   node src/cli.js check             只调只读接口看会员/硬币/券
//   node src/cli.js pause | resume    暂停 / 恢复
import fs from 'node:fs'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { loadConfig } from './config.js'
import { dateText } from './clock.js'
import { readCookie, fetchNav, fetchVoucher, receiveVoucher, fetchCoin, fetchFollowingsTotal } from './api.js'
import { memberFromNav } from './member.js'
import { voucherDecision } from './voucher.js'
import { runConsole } from './console-runner.js'
import { runLogin } from './login.js'
import { sendWecom } from './notify.js'
import { buildActionMessage } from './messages.js'
import { runOnce } from './run.js'
import { peerRunning } from './lock.js'
import { attemptsToday, loadState, saveState, setPaused } from './state.js'

const USAGE = `用法:node src/cli.js <命令> [选项]

  run [--dry-run]   完整跑一次(计划任务入口);--dry-run 只打印会发什么
  login             扫码登录一次,产物落 secrets/cookies.json
  status            本地状态:上次运行、当天次数、台账尾部
  cookies           列出 cookies.json 的账号与条数,不打印 cookie 值
  check             只调只读接口,打印会员类型 / 硬币余额 / 券状态
  pause | resume    暂停 / 恢复无人值守运行
  help              显示本帮助`

function freeMemoryMb() {
    try {
        const m = /^MemAvailable:\s+(\d+) kB/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'))
        if (m) return Math.round(Number(m[1]) / 1024)
    } catch { /* 非 Linux 或读不到,走兜底 */ }
    return Math.round(os.freemem() / 1048576)
}

const tail = (rows, n = 5) => rows.slice(-n)

export async function main(argv = process.argv.slice(2), options = {}) {
    const flags = new Set(argv.filter((arg) => arg.startsWith('-')))
    const command = argv.find((arg) => !arg.startsWith('-')) ?? 'run'
    const out = options.log ?? ((line) => process.stdout.write(`${line}\n`))
    const err = options.error ?? ((line) => process.stderr.write(`${line}\n`))
    const now = options.now ?? new Date()
    const env = options.env ?? process.env
    const config = loadConfig({ ...env, BILIBILI_DRY_RUN: flags.has('--dry-run') ? '1' : env.BILIBILI_DRY_RUN })
    const injected = options.deps ?? {}

    if (flags.has('-h') || flags.has('--help') || command === 'help') {
        out(USAGE)
        return 0
    }

    if (command === 'pause' || command === 'resume') {
        const { state } = loadState(config.stateFile)
        setPaused(state, command === 'pause')
        saveState(config.stateFile, state, now)
        out(`已${command === 'pause' ? '暂停' : '恢复'}:${config.stateFile}`)
        return 0
    }

    if (command === 'status') {
        const { state, warnings } = loadState(config.stateFile)
        for (const warning of warnings) err(`[警告] ${warning}`)
        out(`状态文件:${config.stateFile}`)
        out(`账号:${state.account || '未记录'} · 暂停:${state.paused ? '是' : '否'} · 今日尝试:${attemptsToday(state, now, config.dayBoundaryHour)}/${config.maxAttempts}`)
        out(`上次运行:${state.lastRunDay ?? '无'} · 结果:${state.lastResult ?? '无'}`)
        for (const entry of tail(state.coinLedger)) out(`  硬币 ${entry.day} 余额 ${entry.balance} 投 ${entry.target}${entry.stop ? ` 停投 ${entry.stop}` : ''}`)
        for (const entry of tail(state.voucherHistory)) out(`  券 ${entry.day} ${entry.action} state=${entry.state}`)
        return 0
    }

    if (command === 'cookies') {
        const credential = readCookie(config.cookiesFile)
        if (!credential) {
            err(`没有可用的 cookies 文件:${config.cookiesFile}`)
            return 1
        }
        let count = 0
        try { count = JSON.parse(fs.readFileSync(config.cookiesFile, 'utf8'))?.BiliBiliCookies?.length ?? 0 } catch { count = 0 }
        out(`cookies 文件:${config.cookiesFile}`)
        out(`条数:${count}`)
        out(`账号末尾四位:${credential.mid ? String(credential.mid).slice(-4) : '未知'}`)
        out(`csrf:${credential.csrf ? '有' : '无'}`)
        return 0
    }

    if (command === 'check') {
        const credential = readCookie(config.cookiesFile)
        if (!credential) {
            err(`没有可用的 cookies 文件:${config.cookiesFile}`)
            return 1
        }
        const nav = await fetchNav(credential.cookie, { fetchImpl: injected.fetchImpl })
        const member = memberFromNav(nav.ok ? nav.data : null)
        out(`会员:${member.notLoggedIn ? '未登录' : member.tier}`)
        const coin = await fetchCoin(credential.cookie, { fetchImpl: injected.fetchImpl })
        out(`硬币余额:${coin.ok ? coin.data.money : `取不到 · ${coin.error}`}`)
        if (member.tier === 'annual') {
            const voucher = await fetchVoucher(credential.cookie, { fetchImpl: injected.fetchImpl })
            const decision = voucherDecision(voucher.ok ? voucher.data : null)
            out(`券:state=${decision.state} 可领 ${decision.count} 张 已领 ${decision.alreadyReceived} 下次 ${decision.nextReceiveDays} 天`)
        } else {
            out('券:非年度大会员,跳过')
        }
        return 0
    }

    if (command === 'login') {
        const result = await runLogin({
            config,
            spawnImpl: injected.spawnImpl,
            onLink: async (link) => {
                out(`二维码链接:${link}`)
                out('窗口约 50 秒,请立刻用手机 B站 App 扫这个链接里的二维码')
                const sent = await sendWecom(buildActionMessage({ date: dateText(now), kind: 'login', detail: link }), { webhookFile: config.webhookFile, fetchImpl: injected.fetchImpl, sleep: injected.sleep })
                out(`[通知] 二维码链接${sent.ok ? '已推送' : `推送失败:${sent.error}`}`)
            },
            onLine: (line) => out(line)
        })
        if (!result.ok) err(`[失败] ${result.error}`)
        return result.ok ? 0 : 1
    }

    if (command === 'run') {
        const realDeps = {
            log: out,
            readCookie: (file) => readCookie(file),
            peerRunning: () => peerRunning(config.busyPeers),
            freeMb: () => freeMemoryMb(),
            fetchNav: (cookie) => fetchNav(cookie, { fetchImpl: injected.fetchImpl }),
            fetchVoucher: (cookie) => fetchVoucher(cookie, { fetchImpl: injected.fetchImpl }),
            receiveVoucher: (cookie, csrf) => receiveVoucher(cookie, csrf, { fetchImpl: injected.fetchImpl }),
            fetchCoin: (cookie) => fetchCoin(cookie, { fetchImpl: injected.fetchImpl }),
            fetchFollowingsTotal: (cookie, mid) => fetchFollowingsTotal(cookie, mid, { fetchImpl: injected.fetchImpl }),
            runConsole: (tasks, envMap, runDeps) => runConsole(tasks, envMap, { ...runDeps, spawnImpl: injected.spawnImpl }),
            send: async (text) => {
                const sent = await sendWecom(text, { webhookFile: config.webhookFile, fetchImpl: injected.fetchImpl, sleep: injected.sleep })
                out(`[通知] 企业微信${sent.ok ? '已发送' : `发送失败:${sent.error}`}`)
                return sent
            }
        }
        const result = await runOnce({ config, now, deps: { ...realDeps, ...injected } })
        if (result.dryRun) out(result.planned.join('\n---\n'))
        return result.code
    }

    err(USAGE)
    return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().then((code) => {
        process.exitCode = code
    }).catch((error) => {
        process.stderr.write(`[错误] ${error?.message ?? error}\n`)
        process.exitCode = 1
    })
}
