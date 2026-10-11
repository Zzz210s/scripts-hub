// 一次运行的编排:no-credentials -> 守卫 -> 单实例锁 -> 会员判定 -> start -> 券 -> 硬币/关注
// -> Console -> 归类 -> result -> 落状态。外部动作全部从 deps 注入,整条链路可离线测试。
import { buildConsoleEnv, RUN_TASKS } from './console-runner.js'
import { classifyRun, computeExp } from './classify.js'
import { expFromReward, incompleteTasks } from './exp.js'
import { coinTarget } from './donate.js'
import { dayKey, dateText } from './clock.js'
import { shouldSkipLocally } from './guards.js'
import { buildActionMessage, buildResultMessage, buildStartMessage } from './messages.js'
import { memberFromNav } from './member.js'
import { handleVoucher } from './voucher-flow.js'
import { acquireLock, clearLock } from './lock.js'
import { appendCoinLedger, appendVoucher, attemptsToday, loadState, recordAttempt, saveState, setResult } from './state.js'

const done = (payload) => payload

async function handleDonate({ config, deps, credential, log }) {
    const balanceResult = await deps.fetchCoin(credential.cookie)
    const balance = balanceResult.ok ? balanceResult.data.money : null
    const stopped = (reason) => ({ coin: { target: 0, stop: true, reason }, result: { target: 0, stop: true, reason, threshold: config.coinKeep, balance } })
    if (balance === null) {
        log('[投币] 未取到硬币余额,本次不投币')
        return stopped('no-balance')
    }
    const follow = await deps.fetchFollowingsTotal(credential.cookie, credential.mid)
    if (!follow.ok) {
        log('[投币] 无法确认关注列表,本次不投币')
        return stopped('unknown-followings')
    }
    if (follow.total < 1) {
        log('[投币] 关注列表为空,本次不投币')
        return stopped('no-followings')
    }
    const coin = coinTarget({ balance, threshold: config.coinKeep, max: config.coinMax })
    log(`[投币] 余额 ${balance} · 目标 ${coin.target} 枚`)
    return {
        coin,
        result: coin.stop
            ? { target: 0, stop: true, reason: coin.reason, threshold: config.coinKeep, balance }
            : { target: coin.target, stop: false, reason: null, balance }
    }
}

export async function runOnce({ config, deps = {}, now = new Date() }) {
    const log = deps.log ?? (() => {})
    const date = dateText(now)
    const day = dayKey(now, config.dayBoundaryHour)
    const { state, warnings } = loadState(config.stateFile)
    for (const warning of warnings) log(`[警告] ${warning}`)

    // 1. 从未登录过 -> 静音跳过(D20):守卫之前判,避免每次触发都推 action
    const credential = deps.readCookie ? deps.readCookie(config.cookiesFile) : null
    if (!credential) {
        log('[跳过] no-credentials · 尚未扫码登录')
        return done({ code: 0, messages: [], reason: 'no-credentials' })
    }

    // 2. 本地守卫
    const skip = shouldSkipLocally({
        now,
        paused: state.paused,
        lastRunDay: state.lastRunDay,
        lastResult: state.lastResult,
        attempts: attemptsToday(state, now, config.dayBoundaryHour),
        maxAttempts: config.maxAttempts,
        peerRunning: (await deps.peerRunning?.()) ?? false,
        freeMb: deps.freeMb?.() ?? Infinity,
        boundaryHour: config.dayBoundaryHour
    })
    if (skip.skip) {
        log(`[跳过] ${skip.reason}${skip.detail ? ` · ${skip.detail}` : ''}`)
        return done({ code: 0, messages: [], reason: skip.reason })
    }

    const account = state.account || '1 个账号'

    // dry-run:只打印会发什么,不联网、不起子进程、不写状态
    if (config.dryRun) {
        const planned = [buildStartMessage({ date, account })]
        return done({ code: 0, dryRun: true, messages: planned, planned })
    }

    // 3. 单实例锁(容器内那把;宿主 run.sh 另有 flock)
    const lock = (deps.acquireLock ?? acquireLock)(config.lockFile, { now })
    if (!lock.ok) {
        log('[跳过] peer-running · 已有一次运行在跑')
        return done({ code: 0, messages: [], reason: 'peer-running' })
    }

    try {
        const messages = []
        const send = async (text) => { messages.push(text); await deps.send(text) }

        // 4. 会员判定;未登录直接推 action,不发 start
        const nav = await deps.fetchNav(credential.cookie)
        const member = memberFromNav(nav.ok ? nav.data : null)
        if (!nav.ok || member.notLoggedIn) {
            await send(buildActionMessage({ date, account, kind: 'cookie-invalid' }))
            setResult(state, { day, result: 'failure' })
            saveState(config.stateFile, state, now)
            return done({ code: 1, messages })
        }
        if (!state.account && credential.mid) state.account = `账号 ${String(credential.mid).slice(-4)}`

        // 5. start
        await send(buildStartMessage({ date, account: state.account || account }))

        // 6. 券 + 7. 硬币/关注
        const voucher = await handleVoucher({ deps, credential, member, day, log })
        const donate = await handleDonate({ config, deps, credential, log })

        // 8. Console(开关矩阵注入) -> 归类
        const env = buildConsoleEnv(config, { coinTarget: donate.coin })
        const run = await deps.runConsole(RUN_TASKS, env, { config, now, onLine: (line) => log(`  ${line}`) })
        const classify = classifyRun({ exitCode: run.code, stdout: run.stdout, timedOut: run.timedOut })

        // 每日任务经验:接口真值优先,取不到才回落估算口径(消息里会标注)
        const reward = typeof deps.fetchExpReward === 'function' ? await deps.fetchExpReward(credential.cookie) : { ok: false }
        const truth = reward?.ok ? expFromReward(reward.data?.data) : null
        const exp = truth ?? computeExp({ classify, target: donate.coin.target })
        // R3:读回校验的完成度。接口取不到时不据此判未完成(降级为按退出码),由 estimated 口径渲染
        const incomplete = truth ? incompleteTasks(truth, { coinTarget: donate.coin.target }) : []

        // R5:用硬币余额前后差值报实际投币数(只在实际会投币时再读一次;并不新增外部动作)
        if (!donate.result.stop && donate.result.target > 0) {
            const after = await deps.fetchCoin(credential.cookie)
            const afterMoney = after?.ok ? after.data.money : null
            donate.result.balanceAfter = afterMoney
            donate.result.actual = afterMoney !== null && Number.isFinite(Number(donate.result.balance))
                ? Math.max(0, Math.round((Number(donate.result.balance) - Number(afterMoney)) * 10) / 10)
                : null
        }

        // 9. result(券结果并入这一条)
        const failures = classify.failures.slice()
        if (voucher.failure) failures.push(voucher.failure)
        if (incomplete.length > 0) {
            const names = { login: '登录', watch: '观看', share: '分享', coins: '投币' }
            failures.push({ kind: 'incomplete', label: '每日任务未完成', note: `每日任务未完成 · ${incomplete.map((name) => names[name] ?? name).join(' ')}未达标` })
        }
        const completed = classify.ok && !voucher.failure && incomplete.length === 0
        const result = buildResultMessage({
            date,
            account: state.account || account,
            exp,
            donate: donate.result,
            voucher: voucher.result,
            manga: classify.guardSkipped ? 'skipped' : (classify.task352 ? 'failed' : 'ok'),
            bigPoint: classify.bigPointFlaky ? 'failed' : null,
            failures,
            ok: completed
        })
        await send(result)

        // 10. 落状态
        recordAttempt(state, now, config.dayBoundaryHour)
        appendCoinLedger(state, { day, balance: donate.result.balance ?? null, target: donate.coin.target, stop: donate.result.stop ? donate.result.reason : null })
        appendVoucher(state, voucher.history)
        setResult(state, { day, result: completed ? 'success' : 'failure' })
        saveState(config.stateFile, state, now)
        log(`[完成] ${completed ? '运行成功' : '运行有失败'}`)
        return done({ code: 0, messages })
    } finally {
        try { clearLock(config.lockFile) } catch { /* 忽略解锁失败 */ }
    }
}
