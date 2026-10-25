// 失败清单的组装与去重(纯函数)。从 run.js 抽出来,便于离线断言「同一件事只报一次」。
//
// 2026-10-25 的真实消息里有三条原因,其中两条是同一件事:
//   `任务接口返回 352 · 异常 · Ray.BiliBiliTool.Domain.Exceptions.BiliBusinessExceptio`
//   `每日任务未完成 · 投币未达标`
// 前者是接口被 WAF 拦(所以投币候选全被丢弃),后者是结果 —— 用户看到的是一堆技术噪音夹着同一个结论。
// 现在:投币未达标且当轮被风控拦过时,只报一句,并说清「下次触发会再试」。
const RETRY_HINT = '下次触发会再试'
const NAMES = { login: '登录', watch: '观看', share: '分享', coins: '投币' }

export const isRateLimited = (classify = {}) => Boolean(classify?.rateLimited)

/** 汇总一条结果消息里的「原因:」行。
 *  @param classify classifyRun 的返回值
 *  @param incomplete 经验真值里未达标的项(login / watch / share / coins)
 *  @param voucherFailure 会员券那一步的失败项,原样并进来
 */
export function buildFailures({ classify = {}, incomplete = [], voucherFailure = null } = {}) {
    const missing = (incomplete ?? []).map((name) => NAMES[name] ?? name)
    // 只把「投币没投出 + 当轮被风控拦过」这一个组合折叠成一句:
    // 别的任务(观看/分享)被风控与投币无关,该单独说。
    const folded = missing.includes(NAMES.coins) && isRateLimited(classify)
    const failures = (classify.failures ?? [])
        .filter((failure) => !(folded && failure.kind === 'rate-limited'))
        .map((failure) => ({ ...failure }))
    if (voucherFailure) failures.push(voucherFailure)
    if (missing.length > 0) {
        // 折叠时也要把「投币之外」的缺失项带上,不能只说投币把别的漏掉
        const others = missing.filter((name) => name !== NAMES.coins)
        const head = others.length ? `${others.join(' ')}未达标 · ` : ''
        const note = folded
            ? `每日任务未完成 · ${head}投币被 B站 临时风控拦截 · ${RETRY_HINT}`
            : `每日任务未完成 · ${missing.join(' ')}未达标`
        failures.push({ kind: 'incomplete', label: '每日任务未完成', note })
    }
    return failures
}
