// 投币:改由薄壳自己做,不再依赖上游 Console 的投币步骤。
//
// 为什么(2026-10-28 实测):上游投币链路里 `GET /x/web-interface/view` 对我们这台机房 IP
// 稳定返回 `{"code":-412,"message":"request was banned"}`,一小时里没有一次成功 ——
// 把上游的请求间隔从 5 秒放宽到 10 秒也没用。而同样的接口用同一份 cookie、同样的 UA/Referer
// 由我们自己按 1.5-2 秒的节奏发,连发 5 次全部 200;`POST /x/web-interface/coin/add` 也一次就成。
// 所以投币换一条调用序列:列候选 -> 查已投 -> 投 -> 由调用方读接口经验自证。
//
// 口径:`GET /x/member/web/exp/reward` 的 coins = 今日投币经验,10 经验 = 1 枚,上限 50。
// HTTP 细节在 coin-http.js;本文件只有策略、幂等与节流。
import { ADD, COINS, POPULAR, RANKING, request } from './coin-http.js'

export const MAX_COIN_EXP = 50
export const EXP_PER_COIN = 10
const DEFAULT_INTERVAL_MS = 1500

// 注意 Number(null) 是 0、Number('') 也是 0 —— 直接把「没有值」当成 0 会让「今日投币经验取不到」
// 被当成「今天还没投过」,于是满额的一天又投一轮(2026-10-28 真机 5 枚就是这么浪费的)。
const num = (value) => (
    value === null || value === undefined || value === '' || typeof value === 'boolean'
        ? null
        : (Number.isFinite(Number(value)) ? Number(value) : null)
)

/**
 * 今天最多投几枚。三个上限取最小:配置的 max、经验缺口换算的枚数、余额减保留值。
 * 经验已满、余额不够、经验取不到时 target 为 0,并给出原因(调用方据此跳过,不当失败)。
 */
export function coinPlan({ balance, keep = 0, max = 5, coinsExp = 0 } = {}) {
    const b = num(balance)
    const exp = num(coinsExp)
    if (b === null || b <= 0) return { target: 0, reason: 'balance-zero' }
    if (b <= Number(keep ?? 0)) return { target: 0, reason: 'below-threshold' }
    // 经验取不到时不下手:宁可少投,也不要像 2026-10-28 那样把满额的一天再投 5 枚
    if (exp === null) return { target: 0, reason: 'exp-unknown' }
    if (exp >= MAX_COIN_EXP) return { target: 0, reason: 'exp-full' }
    const byExp = Math.floor((MAX_COIN_EXP - exp) / EXP_PER_COIN)
    const byBalance = Math.floor(b - Number(keep ?? 0))
    const target = Math.max(0, Math.min(Number(max ?? 0), byExp, byBalance))
    if (target <= 0) return { target: 0, reason: 'nothing-to-do' }
    return { target, reason: null }
}

/**
 * 从「经验读回」里取出今日投币经验。同时接受两种形状,避免再踩一次形状不匹配:
 *   - run 内部解析过的最新视图 `{ coinsExp: 30 }`
 *   - `fetchExpReward` 的原始响应 `{ ok:true, data:{ code:0, data:{ coins:30 } } }`
 * 取不到返回 null —— 调用方必须据此**不投**,否则会把已经满额的一天再投一轮(2026-10-28 实测)。
 */
export function coinsExpOf(payload) {
    if (!payload || typeof payload !== 'object') return null
    const direct = num(payload.coinsExp)
    if (direct !== null) return direct
    const raw = payload.data?.data ?? payload.data ?? null
    return num(raw?.coins)
}

/**
 * 把投币计划落到消息层的 donate 结构上(纯函数)。
 * - 有目标:报出本次打算投几枚,incomplete 判定也按这个数
 * - 经验已满/取不到:明确说清,而不是让消息显示「未投出」
 */
export function applyPlan(donate, plan) {
    if (!donate) return donate
    if (plan?.target > 0) {
        return {
            coin: { target: plan.target, stop: false, reason: null },
            result: { ...donate.result, target: plan.target, stop: false, reason: null }
        }
    }
    if (plan?.reason === 'exp-full' || plan?.reason === 'exp-unknown') {
        return {
            coin: { target: 0, stop: true, reason: plan.reason },
            result: { ...donate.result, target: 0, stop: true, reason: plan.reason }
        }
    }
    return donate
}

/** 候选视频:排行榜优先,失败退热门列表。两条都失败返回 { ok:false, aids:[] } 并带原因。 */
export async function pickCandidates({ cookie, limit = 20, deps = {} } = {}) {
    const errors = []
    for (const [name, url] of [['ranking', RANKING], ['popular', POPULAR]]) {
        const res = await request(url, { cookie, deps })
        if (!res.ok) {
            errors.push(`${name}:${res.error}`)
            continue
        }
        const list = Array.isArray(res.data?.data?.list) ? res.data.data.list : []
        const aids = list.map((item) => Number(item?.aid)).filter((aid) => Number.isFinite(aid) && aid > 0)
        if (aids.length) return { ok: true, aids: aids.slice(0, Math.max(0, limit)), source: name, errors }
        errors.push(`${name}:列表为空`)
    }
    return { ok: false, aids: [], source: null, errors }
}

/** 这个视频投过几枚(`data.multiply`);取不到返回 ok:false,由调用方决定是跳过还是试投。 */
export async function coinState({ cookie, aid, deps = {} } = {}) {
    const res = await request(COINS(aid), { cookie, deps })
    if (!res.ok) return { ok: false, error: res.error }
    return { ok: true, donated: num(res.data?.data?.multiply) ?? 0 }
}

/** 投一枚(multiply=1)。csrf 必须是 cookie 里的 bili_jct,缺失时服务端会拒。 */
export async function addCoin({ cookie, csrf, aid, deps = {} } = {}) {
    const body = new URLSearchParams({ aid: String(aid), multiply: '1', select_like: '0', csrf: String(csrf ?? '') }).toString()
    const res = await request(ADD, {
        cookie,
        deps,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    })
    return { ok: res.ok, code: res.code ?? null, message: res.ok ? '' : res.error }
}

/**
 * 按计划投币:逐条候选先查已投(幂等),再投;两次外部请求之间至少隔 intervalMs。
 * 单个候选失败不中断,全部失败时把第一个错误带回给调用方渲染。
 */
export async function runCoins({ cookie, csrf, plan, limit = 20, intervalMs = DEFAULT_INTERVAL_MS, deps = {} } = {}) {
    const target = Math.max(0, num(plan?.target) ?? 0)
    if (!target) return { donated: 0, tried: 0, skipped: 0, errors: [], reason: plan?.reason ?? 'target-zero', source: null }
    const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    const picked = await pickCandidates({ cookie, limit, deps })
    if (!picked.ok) return { donated: 0, tried: 0, skipped: 0, errors: picked.errors, reason: 'no-candidates', source: null }

    const errors = [...picked.errors]
    let donated = 0
    let tried = 0
    let skipped = 0
    let first = true
    for (const aid of picked.aids) {
        if (donated >= target) break
        if (!first) await sleep(Math.max(DEFAULT_INTERVAL_MS, Number(intervalMs) || DEFAULT_INTERVAL_MS))
        first = false
        const state = await coinState({ cookie, aid, deps })
        if (state.ok && state.donated >= 1) {
            skipped += 1
            continue
        }
        if (!state.ok) errors.push(`state:${state.error}`)
        tried += 1
        const res = await addCoin({ cookie, csrf, aid, deps })
        if (res.ok) donated += 1
        else errors.push(`add:${res.code ?? res.message}`)
    }
    return {
        donated,
        tried,
        skipped,
        errors,
        reason: donated > 0 ? null : (errors[0] ?? 'none-succeeded'),
        source: picked.source
    }
}

/**
 * 运行期的投币胶水:先用调用方给的 readExp 读一次今日投币经验算计划,再投。
 * readExp 由 run.js 注入,返回 fetchExpReward 的原始响应(coinsExpOf 两种形状都认)。
 */
export async function donateForRun({ config, credential, balance, log = () => {}, readExp, deps = {} } = {}) {
    const pre = typeof readExp === 'function' ? await readExp() : null
    const coinsExp = coinsExpOf(pre)
    const plan = coinPlan({ balance, keep: config?.coinKeep, max: config?.coinMax, coinsExp })
    if (plan.target <= 0) {
        log(`[投币] 不投 · ${plan.reason}`)
        return { plan, run: { donated: 0, tried: 0, skipped: 0, errors: [], reason: plan.reason, source: null } }
    }
    log(`[投币] 自己投 ${plan.target} 枚 · 今日投币经验 ${coinsExp}`)
    const run = await runCoins({ cookie: credential?.cookie, csrf: credential?.csrf, plan, deps })
    log(`[投币] 投出 ${run.donated} 枚 · 试 ${run.tried} 条 · 已投过 ${run.skipped} 条${run.errors.length ? ` · 错误 ${run.errors[0]}` : ''}`)
    return { plan, run }
}
