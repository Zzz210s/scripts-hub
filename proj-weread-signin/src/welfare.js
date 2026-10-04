// 阅读器福利书币:查询与领取。
//
// 接口来自 APK 反汇编(BaseBookService.smali 的 Retrofit 注解):
//   GET /reader/welfareCoin?bookId=&chapterUid=&action=query   → {coin, key, title, buttonTitle, type, share}
//   GET /reader/welfareCoin?bookId=&key=&action=get            → 详情
//   GET /reader/welfareCoin?bookId=&key=&action=recv           → 领取
// 实测(2026-10-02):query 返回 200 {"coin":0};recv 返回 200 {};get 缺 key 返回 499 -2057。
import { APP_BASE, appHeaders } from './app-auth.js'

export const WELFARE_PATH = '/reader/welfareCoin'
const DEFAULT_TIMEOUT_MS = 15000
const TEXT_PREVIEW_CHARS = 160

export function buildQuery({ bookId, chapterUid }) {
    const parsed = Number(chapterUid)
    return { action: 'query', bookId, chapterUid: Number.isFinite(parsed) ? Math.trunc(parsed) : 0 }
}

export function buildClaim({ bookId, key }) {
    return { action: 'recv', bookId, key }
}

export function parseWelfare(payload) {
    const source = payload && typeof payload === 'object' ? payload : {}
    const coin = Number(source.coin)
    const type = Number(source.type)
    return {
        coin: Number.isFinite(coin) ? coin : 0,
        key: typeof source.key === 'string' ? source.key : '',
        title: typeof source.title === 'string' ? source.title : '',
        buttonTitle: typeof source.buttonTitle === 'string' ? source.buttonTitle : '',
        type: Number.isFinite(type) ? type : 0
    }
}

export function decideClaim(welfare) {
    // coin 可能是 undefined / NaN(例如把原始 body 直接传进来),所以必须用 Number(...) > 0 判定。
    // 写成 coin <= 0 会让缺字段的情况落进"可领取",是 fail-open(2026-10-02 评审发现)。
    if (!(Number(welfare?.coin) > 0)) return { claim: false, reason: 'no-coin' }
    if (!welfare.key) return { claim: false, reason: 'no-key' }
    return { claim: true, reason: 'claimable' }
}

export async function callWelfare(ctx, params) {
    const query = new URLSearchParams(params).toString()
    const fetchImpl = ctx.fetchImpl ?? globalThis.fetch
    try {
        const response = await fetchImpl(`${APP_BASE}${WELFARE_PATH}?${query}`, {
            headers: appHeaders(ctx.token),
            signal: AbortSignal.timeout(ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
        })
        const text = await response.text()
        let body = {}
        try {
            body = JSON.parse(text)
        } catch { /* 非 JSON 一律当空对象 */ }
        return { ok: response.status === 200, status: response.status, body, text: text.slice(0, TEXT_PREVIEW_CHARS) }
    } catch (error) {
        return { ok: false, status: 0, error: error.message }
    }
}

/**
 * 查询 → 决策 → 领取 → 再查一次自证。永不抛错;失败只体现在返回值里。
 *
 * 返回契约(每个分支的字段集合都相同,缺失的用 null / 默认值占位):
 *   ok       本次流程是否顺利(true/false)
 *   claimed  是否真的领取成功
 *   coin     本次查询到的书币数
 *   key      服务端给的书币 key(未查询到时为空串)
 *   reason   'claimable' | 'no-coin' | 'no-key' | 'claim-failed' | 'query-failed'
 *   verifyOk 自证那次查询本身是否成功(网络层面)
 *   verified 自证成功且 coin 已归零
 *   queryRaw / claimRaw / verifyRaw  三次调用的原始结果(null 表示该步没发生)
 *
 * 注意:判断"领取是否生效"要看 verified;判断"自证请求是否发出去并成功"要看 verifyOk。
 * 两者都为 false 时无法区分"领取没生效"与"没查成"。
 */
export async function claimIfAvailable(ctx) {
    const context = { fetchImpl: globalThis.fetch, timeoutMs: DEFAULT_TIMEOUT_MS, ...ctx }
    const queryParams = buildQuery({ bookId: context.bookId, chapterUid: context.chapterUid })
    const queryResult = await callWelfare(context, queryParams)
    const base = {
        claimed: false, coin: 0, key: '', reason: 'no-coin',
        verifyOk: false, verified: false,
        queryRaw: queryResult, claimRaw: null, verifyRaw: null
    }
    if (!queryResult.ok) {
        return { ...base, ok: false, reason: 'query-failed' }
    }
    const welfare = parseWelfare(queryResult.body)
    const decision = decideClaim(welfare)
    if (!decision.claim) {
        return { ...base, ok: true, coin: welfare.coin, key: welfare.key, reason: decision.reason }
    }
    const claimResult = await callWelfare(context, buildClaim({ bookId: context.bookId, key: welfare.key }))
    if (!claimResult.ok) {
        return { ...base, ok: false, coin: welfare.coin, key: welfare.key, reason: 'claim-failed', claimRaw: claimResult }
    }
    const verifyResult = await callWelfare(context, queryParams)
    const verifyOk = verifyResult.ok
    const verified = verifyOk && parseWelfare(verifyResult.body).coin <= 0
    return { ...base, ok: true, claimed: true, coin: welfare.coin, key: welfare.key, reason: 'claimable', verifyOk, verified, claimRaw: claimResult, verifyRaw: verifyResult }
}
