// 本地状态:已领过的游戏、当天跑了几次、今天已经推过哪条通知。
// 只有这一个文件是「程序记忆」;删掉它等于忘掉所有记录(会重新尝试领取)。
import { readJsonSafe, writeAtomic } from './atomic.js'
import { dayKey } from './clock.js'

export const STATE_VERSION = 1
const TERMINAL = new Set(['claimed', 'existed'])

export function emptyState(now = new Date()) {
    return { version: STATE_VERSION, updatedAt: now.toISOString(), paused: false, account: '', games: {}, days: {} }
}

export function loadState(file) {
    const { value, error } = readJsonSafe(file, null)
    if (error) return { state: emptyState(), warnings: [error] }
    if (value === null) return { state: emptyState(), warnings: [] }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { state: emptyState(), warnings: [`${file} 不是对象,已回退空状态`] }
    return {
        state: {
            version: STATE_VERSION,
            updatedAt: value.updatedAt,
            paused: value.paused === true,
            account: typeof value.account === 'string' ? value.account : '',
            games: value.games && typeof value.games === 'object' && !Array.isArray(value.games) ? value.games : {},
            days: value.days && typeof value.days === 'object' && !Array.isArray(value.days) ? value.days : {}
        },
        warnings: []
    }
}

export function saveState(file, state, now = new Date()) {
    state.updatedAt = now.toISOString()
    writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`)
}

const today = (state, now) => (state.days[dayKey(now)] ??= { attempts: 0, notified: {}, checkedAt: null })

export const gameStatus = (state, slug) => state.games?.[slug]?.status ?? null

/** 还有哪些当期免费游戏没拿到。已领过或已在库里 / 重复出现的 slug 都排除。 */
export function pendingGames(state, games) {
    const seen = new Set()
    const out = []
    for (const game of games ?? []) {
        if (!game?.slug || seen.has(game.slug)) continue
        seen.add(game.slug)
        if (TERMINAL.has(gameStatus(state, game.slug))) continue
        out.push(game)
    }
    return out
}

export const attemptsToday = (state, now) => today(state, now).attempts
export const canAttempt = (state, now, maxAttempts) => attemptsToday(state, now) < maxAttempts

export function recordAttempt(state, now = new Date()) {
    const day = today(state, now)
    day.attempts += 1
    day.checkedAt = now.toISOString()
    state.updatedAt = now.toISOString()
}

/** 记一条游戏结论;首次见到就写 firstSeenAt,终态再写 claimedAt。url 等字段留给离线 link 用。 */
export function markGame(state, game, status, now = new Date()) {
    const entry = (state.games[game.slug] ??= { title: game.title ?? game.slug, firstSeenAt: now.toISOString(), status: null, claimedAt: null })
    entry.title = game.title ?? entry.title
    for (const field of ['url', 'offerId', 'namespace']) {
        if (game[field]) entry[field] = game[field]
    }
    entry.status = status
    if (TERMINAL.has(status)) entry.claimedAt = now.toISOString()
}

/** 丢掉过期的终态记录(默认 400 天),没领到的一直留着以便重试。 */
export function pruneState(state, now = new Date(), days = 400) {
    const cutoff = now.getTime() - days * 86400000
    for (const [slug, entry] of Object.entries(state.games ?? {})) {
        const stamp = entry.claimedAt ? Date.parse(entry.claimedAt) : NaN
        if (!TERMINAL.has(entry.status) || Number.isNaN(stamp) || stamp >= cutoff) continue
        delete state.games[slug]
    }
    const cutoffDay = dayKey(new Date(cutoff))
    for (const key of Object.keys(state.days ?? {})) {
        if (key < cutoffDay) delete state.days[key]
    }
}

export const notifiedOnce = (state, key, now) => today(state, now).notified?.[key] === true
export function markNotified(state, key, now = new Date()) {
    today(state, now).notified[key] = true
}

export function setPaused(state, paused, now = new Date()) {
    state.paused = paused === true
    state.updatedAt = now.toISOString()
}
