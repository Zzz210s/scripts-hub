// 为什么某个账号这次几乎没得分:从日志里读出"运行前的可赚积分"与"搜索阶段是否被跳过"。
// 2026-09-27 的真实案例:两个账号只 +15/+45,查下来是运行前配额已满,脚本按状态正确跳过了。
// 这里只做归因说明,不改变运行行为。
const EARNABLE_RE = /\[POINTS\] Earnable today \| Mobile: (\d+) \| Browser: (\d+) \| App: (\d+) \| (\S+) \|/
const SEARCH_STATE_RE = /\[SEARCH-MANAGER\] Mobile: (?:skip|run) \([^)]*\) \| Desktop: (\w+) \(([^)]*)\)/

/** 低于这个分数才附上原因,避免给正常账号加噪音(正常日单账号 195-250 分)。 */
export const LOW_SCORE_THRESHOLD = 50

/**
 * @param {string} email 账号邮箱(日志里的账号标签是它 @ 之前的本地部分)
 * @param {string[]} lines 整份运行日志
 * @returns {string|null} 人类可读的原因,读不出来则返回 null
 */
export function explainLowScore(email, lines) {
    const tag = String(email).split('@')[0]
    if (!tag) return null
    const scoped = lines.filter(line => line.includes(`[${tag}]`))
    const earnable = scoped.map(line => line.match(EARNABLE_RE)).find(Boolean)
    const search = scoped.map(line => line.match(SEARCH_STATE_RE)).find(Boolean)

    const notes = []
    if (earnable) {
        const browser = Number(earnable[2])
        const app = Number(earnable[3])
        if (browser === 0) {
            notes.push(`运行前桌面搜索已无可赚积分(${browser}/满)`)
        }
        if (app <= 5) {
            notes.push(`App 侧可赚积分仅剩 ${app} 分`)
        }
    }
    if (search && search[1].toLowerCase() === 'skip') {
        notes.push(`搜索阶段被判定为已完成而跳过(进度 ${search[2]})`)
    }
    return notes.length ? notes.join(';') : null
}
