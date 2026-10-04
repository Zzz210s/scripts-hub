// 引擎结果归类(纯):上游 lowdb 里的状态 + stdout 特征 -> 每条游戏的结论。
// 上游可能写的状态见 vendor/free-games-claimer/epic-games.js:
// claimed / existed / manual / failed / failed:requires-base-game / unavailable-in-region / skipped。
const VENDOR_STATUS = {
    claimed: 'claimed',
    existed: 'existed',
    manual: 'existed',
    'unavailable-in-region': 'unavailable',
    'failed:requires-base-game': 'requires-base-game',
    failed: 'failed',
    skipped: 'missing'
}

export const detectCaptcha = (stdout = '') => /captcha/i.test(String(stdout))
export const detectLoginRequired = (stdout = '') => /not signed in anymore|please login|run `show=1 node epic-games`/i.test(String(stdout))

/** 在 lowdb 的 `{ 账号: { slug: 条目 } }` 里找一条游戏的原始状态。 */
export function findGameStatus(db, slug) {
    for (const games of Object.values(db ?? {})) {
        const status = games?.[slug]?.status
        if (status) return String(status)
    }
    return null
}

/** lowdb 里的账号显示名(单账号时就是它);取不到给空串,消息层会用「1 个账号」兜底。 */
export function accountName(db) {
    const names = Object.keys(db ?? {})
    return names.length === 1 ? names[0] : ''
}

function noteFor(vendorStatus, { captcha, loginRequired, code }) {
    if (captcha) return '结账时遇到 hCaptcha 验证'
    if (loginRequired) return '浏览器登录态已失效'
    if (vendorStatus && vendorStatus.startsWith('failed:')) return `上游状态 ${vendorStatus}`
    if (vendorStatus) return `上游状态 ${vendorStatus}`
    return code ? `领取进程退出码 ${code}` : undefined
}

/**
 * 把一次引擎运行翻译成可发送的结论。
 * expected = 我们期望拿到的当期免费项;db = 上游跑完写的 lowdb;stdout = 引擎控制台输出。
 */
export function summarizeRun({ expected = [], db = {}, stdout = '', code = 0 } = {}) {
    const captcha = detectCaptcha(stdout)
    const loginRequired = detectLoginRequired(stdout)
    const games = expected.map((game) => {
        const vendorStatus = findGameStatus(db, game.slug)
        const status = (vendorStatus && VENDOR_STATUS[vendorStatus]) || (captcha ? 'failed' : 'missing')
        const failed = status !== 'claimed' && status !== 'existed'
        return { slug: game.slug, title: game.title, status, note: failed ? noteFor(vendorStatus, { captcha, loginRequired, code }) : undefined }
    })
    return { games, captcha, loginRequired, ok: games.every((game) => game.status === 'claimed' || game.status === 'existed') }
}
