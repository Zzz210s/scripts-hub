// 自研投币(2026-10-28):上游那条链路被 WAF 拦死,改由薄壳投。这里锁住计划口径、
// 幂等(已投过跳过)、失败不中断,以及与 run.js 的接线。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addCoin, applyPlan, coinPlan, coinState, coinsExpOf, donateForRun, pickCandidates, runCoins } from '../src/coin.js'
import { renderDonateLine } from '../src/messages.js'
import { runOnce } from '../src/run.js'
import { NOW, makeDeps, setup } from './run-helpers.js'

const jsonResponse = (payload, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(payload) })

test('coinPlan:经验已满 / 余额不足 / 正常 / 受 max 限制', () => {
    assert.deepEqual(coinPlan({ balance: 200, keep: 20, max: 5, coinsExp: 50 }), { target: 0, reason: 'exp-full' })
    assert.deepEqual(coinPlan({ balance: 10, keep: 20, max: 5, coinsExp: 0 }), { target: 0, reason: 'below-threshold' })
    assert.deepEqual(coinPlan({ balance: 0, keep: 20, max: 5, coinsExp: 0 }), { target: 0, reason: 'balance-zero' })
    // 20 经验已得 -> 缺口 30 经验 = 3 枚
    assert.deepEqual(coinPlan({ balance: 200, keep: 20, max: 5, coinsExp: 20 }), { target: 3, reason: null })
    // 经验缺口 5 枚但 max 是 2 -> 取 2
    assert.deepEqual(coinPlan({ balance: 200, keep: 20, max: 2, coinsExp: 0 }), { target: 2, reason: null })
    // 余额只够投 1 枚
    assert.deepEqual(coinPlan({ balance: 21, keep: 20, max: 5, coinsExp: 0 }), { target: 1, reason: null })
})

test('pickCandidates:排行榜优先,失败退热门;两条都失败返回原因', async () => {
    const ranking = { code: 0, data: { list: [{ aid: 1 }, { aid: 2 }, { aid: 'x' }] } }
    const ok = await pickCandidates({ cookie: 'c', limit: 5, deps: { fetchImpl: async () => jsonResponse(ranking) } })
    assert.deepEqual(ok.aids, [1, 2])
    assert.equal(ok.source, 'ranking')

    const calls = []
    const fallback = await pickCandidates({
        cookie: 'c',
        deps: {
            fetchImpl: async (url) => {
                calls.push(url)
                if (url.includes('ranking')) return jsonResponse({ code: -412, message: 'request was banned' })
                return jsonResponse({ code: 0, data: { list: [{ aid: 7 }] } })
            }
        }
    })
    assert.deepEqual(fallback.aids, [7])
    assert.equal(fallback.source, 'popular')
    assert.equal(calls.length, 2)

    const none = await pickCandidates({ cookie: 'c', deps: { fetchImpl: async () => jsonResponse({ code: -352 }) } })
    assert.equal(none.ok, false)
    assert.equal(none.aids.length, 0)
    assert.match(none.errors[0], /ranking/)
})

test('coinState / addCoin:已投数与投币成功、失败各自的解码', async () => {
    const state = await coinState({ cookie: 'c', aid: 5, deps: { fetchImpl: async () => jsonResponse({ code: 0, data: { multiply: 2 } }) } })
    assert.deepEqual(state, { ok: true, donated: 2 })

    const okAdd = await addCoin({ cookie: 'c', csrf: 'jct', aid: 5, deps: { fetchImpl: async (url, init) => {
        assert.equal(init.method, 'POST')
        assert.match(String(init.body), /csrf=jct/)
        return jsonResponse({ code: 0, data: { like: false } })
    } } })
    assert.equal(okAdd.ok, true)

    const badAdd = await addCoin({ cookie: 'c', csrf: 'jct', aid: 5, deps: { fetchImpl: async () => jsonResponse({ code: -111, message: 'csrf 校验失败' }) } })
    assert.equal(badAdd.ok, false)
    assert.equal(badAdd.code, -111)
})

test('runCoins:已投过的候选跳过,投到达标即停,间隔不小于 1500ms', async () => {
    const sleeps = []
    const donatedAids = []
    const fetchImpl = async (url, init) => {
        if (url.includes('ranking')) return jsonResponse({ code: 0, data: { list: [{ aid: 1 }, { aid: 2 }, { aid: 3 }] } })
        if (url.includes('archive/coins')) return jsonResponse({ code: 0, data: { multiply: url.includes('aid=1') ? 1 : 0 } })
        donatedAids.push(/aid=(\d+)/.exec(String(init.body))?.[1])
        return jsonResponse({ code: 0, data: { like: false } })
    }
    const result = await runCoins({
        cookie: 'c', csrf: 'jct', plan: { target: 2 }, intervalMs: 1200,
        deps: { fetchImpl, sleep: async (ms) => { sleeps.push(ms) } }
    })
    assert.equal(result.donated, 2)
    assert.equal(result.skipped, 1, 'aid=1 已经投过,应跳过')
    assert.deepEqual(donatedAids, ['2', '3'])
    assert.ok(sleeps.length >= 1 && sleeps.every((ms) => ms >= 1500), `间隔应 >=1500ms,实际 ${JSON.stringify(sleeps)}`)
})

test('runCoins:全部失败不抛,把第一个错误带回', async () => {
    const fetchImpl = async (url, init) => {
        if (url.includes('ranking')) return jsonResponse({ code: 0, data: { list: [{ aid: 9 }] } })
        if (url.includes('archive/coins')) return jsonResponse({ code: 0, data: { multiply: 0 } })
        return jsonResponse({ code: -412, message: 'request was banned' })
    }
    const result = await runCoins({ cookie: 'c', csrf: 'jct', plan: { target: 1 }, deps: { fetchImpl, sleep: async () => {} } })
    assert.equal(result.donated, 0)
    assert.match(String(result.reason), /412/)
})

test('接线:注入 donateCoins 时按它的计划投币,消息报本次与实际累计', async () => {
    const { config } = setup()
    let reads = 0
    const seen = []
    const deps = makeDeps({
        fetchCoin: async () => { reads += 1; return { ok: true, data: { money: reads === 1 ? 200 : 198 } } },
        donateCoins: async ({ balance, readExp }) => {
            const exp = await readExp()
            seen.push({ balance, coinsExp: exp.data.data.coins })
            return { plan: { target: 2, reason: null }, run: { donated: 2, tried: 2, skipped: 0, errors: [] } }
        }
    })
    const result = await runOnce({ config, deps, now: NOW })
    const text = result.messages[1]
    assert.deepEqual(seen, [{ balance: 200, coinsExp: 50 }])
    assert.ok(text.includes('投币:2 枚 · 投给关注的 UP · 今日累计 5 枚 · 余额 198.0'), text)
})

test('接线:没注入 donateCoins 时完全不投(保持旧行为,测试与 check 命令不受影响)', async () => {
    const { config } = setup()
    const deps = makeDeps()
    const result = await runOnce({ config, deps, now: NOW })
    assert.ok(result.messages[1].includes('投币:3 枚'), result.messages[1])
})

test('applyPlan:有目标是本次投几枚;经验已满说「已满」而不是「未投出」', () => {
    const base = { coin: { target: 5, stop: false, reason: null }, result: { target: 5, stop: false, reason: null, balance: 200 } }
    const planned = applyPlan(base, { target: 2, reason: null })
    assert.equal(planned.coin.target, 2)
    assert.equal(planned.result.stop, false)

    const full = applyPlan(base, { target: 0, reason: 'exp-full' })
    assert.equal(full.coin.stop, true)
    assert.equal(full.result.reason, 'exp-full')
    assert.equal(renderDonateLine({ ...full.result, actual: null, balance: 200 }), '投币:今日投币经验已满 · 不投')

    // 其它原因(余额不足等)保持原样,不覆盖 handleDonate 已给出的跳过原因
    assert.deepEqual(applyPlan(base, { target: 0, reason: 'below-threshold' }), base)
})

test('接线:经验已满时 donateCoins 返回 target 0,消息显示已满且不判未完成', async () => {
    const { config } = setup()
    const deps = makeDeps({
        donateCoins: async () => ({ plan: { target: 0, reason: 'exp-full' }, run: { donated: 0, tried: 0, skipped: 0, errors: [], reason: 'exp-full' } })
    })
    const result = await runOnce({ config, deps, now: NOW })
    const text = result.messages[1]
    assert.ok(text.includes('投币:今日投币经验已满 · 不投'), text)
    assert.ok(!text.includes('投币未达标'), text)
})

// 回归(2026-10-28 真机事故):readExp 注入的是 fetchExpReward 的**原始响应**,而 coinPlan 之前
// 只认解析过的 { coinsExp },于是「今日投币经验」被当成 0,已经满额的 50 经验那天又投了 5 枚。
test('coinsExpOf:原始响应与已解析视图都能取出今日投币经验', () => {
    assert.equal(coinsExpOf({ ok: true, data: { code: 0, data: { coins: 50 } } }), 50)
    assert.equal(coinsExpOf({ coinsExp: 30 }), 30)
    assert.equal(coinsExpOf({ ok: false }), null)
    assert.equal(coinsExpOf(null), null)
    assert.equal(coinsExpOf({ ok: true, data: { code: 0, data: {} } }), null)
})

test('经验满额(原始响应形状)时计划为 0,不会再多投', async () => {
    const { config } = setup()
    const deps = {
        config,
        credential: { cookie: 'c', csrf: 'jct', mid: '1' },
        balance: 235.6,
        log: () => {},
        // 真实形状:还没解析过
        readExp: async () => ({ ok: true, data: { code: 0, data: { coins: 50, login: true } } }),
        deps: { fetchImpl: async () => { throw new Error('满额时不该发任何请求') } }
    }
    const out = await donateForRun(deps)
    assert.deepEqual(out.plan, { target: 0, reason: 'exp-full' })
    assert.equal(out.run.donated, 0)
})

test('经验取不到时计划为 0(exp-unknown),不盲投', async () => {
    const out = await donateForRun({
        config: { coinKeep: 20, coinMax: 5 },
        credential: { cookie: 'c', csrf: 'jct' },
        balance: 200,
        readExp: async () => ({ ok: false, error: 'HTTP 500' }),
        deps: { fetchImpl: async () => { throw new Error('取不到经验时不该发请求') } }
    })
    assert.deepEqual(out.plan, { target: 0, reason: 'exp-unknown' })
    assert.equal(out.run.donated, 0)
})

// 真机路径的完整形状:readExp 给原始响应,runCoins 用真实 fetchImpl 走排行榜 -> 查已投 -> 投。
test('donateForRun:原始响应 coins=20 时按缺口投 3 枚并停手', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
        calls.push(url.includes('coin/add') ? 'add' : url.includes('archive/coins') ? 'state' : 'list')
        if (url.includes('ranking')) return jsonResponse({ code: 0, data: { list: [{ aid: 11 }, { aid: 12 }, { aid: 13 }, { aid: 14 }] } })
        if (url.includes('archive/coins')) return jsonResponse({ code: 0, data: { multiply: 0 } })
        if (init?.method === 'POST') return jsonResponse({ code: 0, data: { like: false } })
        return jsonResponse({ code: 0, data: {} })
    }
    const out = await donateForRun({
        config: { coinKeep: 20, coinMax: 5 },
        credential: { cookie: 'c', csrf: 'jct' },
        balance: 235.6,
        readExp: async () => ({ ok: true, data: { code: 0, data: { coins: 20 } } }),
        deps: { fetchImpl, sleep: async () => {} }
    })
    assert.deepEqual(out.plan, { target: 3, reason: null })
    assert.equal(out.run.donated, 3)
    assert.equal(calls.filter((c) => c === 'add').length, 3, '只投 3 枚,不多投')
})
