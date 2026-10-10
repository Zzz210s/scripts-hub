// 一次运行的编排:no-credentials -> 守卫 -> 单实例锁 -> 会员判定 -> start -> 券 -> 硬币/关注
// -> Console -> 归类 -> result -> 落状态。外部动作全部从 deps 注入,整条链路可离线测试。
import { buildConsoleEnv, RUN_TASKS } from './console-runner.js'
import { classifyRun, computeExp } from './classify.js'
import { coinTarget } from './donate.js'
import { dayKey, dateText } from './clock.js'
import { shouldSkipLocally } from './guards.js'
import { buildActionMessage, buildResultMessage, buildStartMessage } from './messages.js'
import { memberFromNav } from './member.js'
import { voucherDecision } from './voucher.js'
import { acquireLock, clearLock } from './lock.js'
import { appendCoinLedger, appendVoucher, attemptsToday, loadState, recordAttempt, saveState, setResult } from './state.js'

const done = (payload) => payload

async function handleVoucher({ deps, credential, member, day, log }) {
    const skip = (action, extra = {}) => ({
        result: { action, tier: member.tier, count: 0, balance: member.couponBalance, ...extra },
        history: { day, action, state: extra.state ?? null, expireTime: extra.expireTime ?? null, nextReceiveDays: extra.nextReceiveDays ?? null }
    })
    if (member.tier !== 'annual') {
        log('[券] 非年度大会员,跳过 B币券')
        return skip('skipped-none')
    }
    if (!credential.csrf) {
        log('[券] cookie 里没有 bili_jct,跳过')
        return { ...skip('unknown'), failure: { kind: 'voucher-no-csrf', label: '缺少 csrf', note: '会员券 · cookie 里没有 bili_jct · 未领取', ignored: true } }
    }
    const first = await deps.fetchVoucher(credential.cookie)
    const decision = voucherDecision(first.ok ? first.data : null)
    if (!decision.shouldReceive) {
        const action = decision.alreadyReceived ? 'already' : (first.ok ? 'skipped-none' : 'unknown')
        log(`[券] 不领取 · state=${decision.state}`)
        return skip(action, { state: decision.state, expireTime: decision.expireTime, nextReceiveDays: decision.nextReceiveDays })
    }
    await deps.receiveVoucher(credential.cookie, credential.csrf)
    const again = await deps.fetchVoucher(credential.cookie)
    const verified = voucherDecision(again.ok ? again.data : null)
    const received = verified.alreadyReceived
    log(`[券] 领取${received ? '成功' : '未自证'}`)
    return skip(received ? 'received' : 'unknown', {
        count: decision.count,
        state: verified.state,
        expireTime: verified.expireTime,
        nextReceiveDays: verified.nextReceiveDays
    })
}

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

        // 9. result(券结果并入这一条)
        const failures = classify.failures.slice()
        if (voucher.failure) failures.push(voucher.failure)
        const result = buildResultMessage({
            date,
            account: state.account || account,
            exp: computeExp({ classify, target: donate.coin.target }),
            donate: donate.result,
            voucher: voucher.result,
            manga: classify.task352 ? 'failed' : 'ok',
            bigPoint: classify.bigPointFlaky ? 'failed' : null,
            failures,
            ok: classify.ok && !voucher.failure
        })
        await send(result)

        // 10. 落状态
        recordAttempt(state, now, config.dayBoundaryHour)
        appendCoinLedger(state, { day, balance: donate.result.balance ?? null, target: donate.coin.target, stop: donate.result.stop ? donate.result.reason : null })
        appendVoucher(state, voucher.history)
        setResult(state, { day, result: classify.ok && !voucher.failure ? 'success' : 'failure' })
        saveState(config.stateFile, state, now)
        log(`[完成] ${classify.ok ? '运行成功' : '运行有失败'}`)
        return done({ code: 0, messages })
    } finally {
        try { clearLock(config.lockFile) } catch { /* 忽略解锁失败 */ }
    }
}
