// 一次运行的编排。外部动作(探测、引擎、读结果、发消息、内存、同伴)全部从 deps 注入,
// 所以整条链路可以在没有网络、没有浏览器、没有凭据的情况下测试。
import { accountName, summarizeRun } from './classify.js'
import { cycleEnd, dayKey, formatLocal } from './clock.js'
import { shouldSkipLocally } from './guards.js'
import { buildActionMessage, buildResultMessage, buildSkipMessage, buildStartMessage } from './messages.js'
import { isSilentSkip } from './policy.js'
import { checkoutUrl } from './promo.js'
import { attemptsToday, loadState, markGame, markNotified, notifiedOnce, pendingGames, pruneState, recordAttempt, saveState } from './state.js'

const MESSAGE_DATE = (now) => dayKey(now)

async function skipWithNotice({ config, deps, state, now, reason }) {
    const account = state.account || ''
    const date = MESSAGE_DATE(now)
    if (isSilentSkip(reason)) return false
    const key = `skip:${reason}`
    if (notifiedOnce(state, key, now)) return false
    await deps.send(buildSkipMessage({ date, account, reason }))
    markNotified(state, key, now)
    saveState(config.stateFile, state, now)
    return true
}

/**
 * 返回 { code, skipped?, planned?, summary? }。
 * dry-run 只算「会发什么」,不探测、不起浏览器、不发送。
 */
export async function runOnce({ config, deps = {}, now = new Date() }) {
    const log = deps.log ?? ((line) => console.log(line))
    const date = MESSAGE_DATE(now)
    const { state, warnings } = loadState(config.stateFile)
    for (const warning of warnings) log(`[警告] ${warning}`)
    const account = state.account || ''

    const skip = shouldSkipLocally({
        now,
        paused: state.paused,
        attempts: attemptsToday(state, now),
        maxAttempts: config.maxAttemptsPerDay,
        peerRunning: (await deps.peerRunning?.()) ?? false,
        freeMb: deps.freeMb?.() ?? Infinity
    })

    if (config.dryRun) {
        const planned = skip.skip
            ? (isSilentSkip(skip.reason) ? [] : [buildSkipMessage({ date, account, reason: skip.reason })])
            : [buildStartMessage({ date, account })]
        return { code: 0, dryRun: true, skipped: skip.skip ? skip.reason : undefined, planned }
    }

    if (skip.skip) {
        log(`[跳过] ${skip.reason}${skip.detail ? ` · ${skip.detail}` : ''}`)
        await skipWithNotice({ config, deps, state, now, reason: skip.reason })
        return { code: 0, skipped: skip.reason }
    }

    const probed = await deps.probe({ config, now })
    if (!probed.ok) {
        log(`[跳过] probe-failed · ${probed.error}`)
        await skipWithNotice({ config, deps, state, now, reason: 'probe-failed' })
        return { code: 1, error: probed.error }
    }

    const pending = pendingGames(state, probed.current)
    const deadline = probed.current.find((game) => game.endAt)?.endAt ?? cycleEnd(now)
    if (!pending.length) {
        log(`[跳过] nothing-new · 当期 ${probed.current.length} 个,都已领过`)
        return { code: 0, skipped: 'nothing-new', upcoming: probed.upcoming }
    }

    // 先保证有可用登录态:有 token 就续期并注入 profile;都没有才退回 profile 既有会话。
    const ensure = deps.ensureSession ?? (async () => ({ ok: true, mode: 'none' }))
    const session = await ensure({ config, now, log })
    if (session.warn) log(`[警告] ${session.warn}`)
    if (!session.ok) {
        log(`[跳过] auth-failed · ${session.error}`)
        await deps.send(buildActionMessage({ date, account, kind: session.needsLogin ? 'login' : 'auth-network', items: [] }))
        return { code: 1, error: session.error, session }
    }

    recordAttempt(state, now)
    saveState(config.stateFile, state, now)
    log(`[领取] ${pending.map((game) => game.title).join(', ')}`)

    await deps.send(buildStartMessage({ date, account }))
    const run = await deps.runEngine({ config, pending })
    const summary = summarizeRun({ expected: pending, db: deps.readDb({ config }) ?? {}, stdout: run.stdout, code: run.code })

    for (const game of summary.games) markGame(state, game, game.status, now)
    const discovered = accountName(deps.readDb({ config }) ?? {})
    if (discovered) state.account = discovered
    pruneState(state, now)
    saveState(config.stateFile, state, now)

    const finalAccount = state.account || account
    const failed = summary.games.filter((game) => game.status !== 'claimed' && game.status !== 'existed')
    if (failed.length) {
        const kind = summary.loginRequired ? 'login' : summary.captcha ? 'captcha' : 'blocked'
        const items = failed.map((game) => {
            const source = pending.find((item) => item.slug === game.slug) ?? {}
            return { title: game.title, checkout: checkoutUrl(source), endAt: source.endAt ?? deadline }
        })
        await deps.send(buildActionMessage({ date, account: finalAccount, kind, items }))
    } else {
        await deps.send(buildResultMessage({ date, account: finalAccount, games: summary.games, cycleEnd: deadline }))
    }
    log(`[完成] ${formatLocal(now)} · ${summary.ok ? '全部拿到' : '有未领取'}`)
    return { code: summary.ok ? 0 : 1, summary }
}
