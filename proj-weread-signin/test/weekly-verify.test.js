// src/weekly-verify.js 的单元测试:等待复查(R1)+ 重领反证(R2)+ 不扩范围(R3)。
// 全离线:query / reclaim / sleep 全部注入,不碰真网络,也不真等 6-10 秒。
import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyWeekly } from '../src/weekly-verify.js'

const CTX = { token: { accessToken: 'tok' }, fetchImpl: async () => { throw new Error('测试里不许走真网络') } }
const PICK = { levelId: 13, levelDesc: '读 7 天', choiceType: 1, awardNum: 2 }
const weeklyWith = (claimed = [PICK]) => ({
    ok: true, readingSeconds: 26392, readingDays: 7, claimable: claimed.length, claimed, alreadyClaimed: [], failed: []
})
const deps = (overrides = {}) => ({ sleep: async () => {}, delayMs: 0, ...overrides })
const statusQuery = code => async () => ({ ok: true, awards: [{ levelId: 13, status: code }] })
const reclaimWith = result => async () => result

test('R1 第一次查不到、第二次查到:via=status,只查 2 次、只等 1 次(不白等)', async () => {
    const queried = []
    const slept = []
    const query = async () => {
        queried.push(1)
        return { ok: true, awards: [{ levelId: 13, status: queried.length >= 2 ? 2 : 0 }] }
    }
    const result = await verifyWeekly(CTX, weeklyWith(), deps({ query, sleep: async ms => slept.push(ms) }))

    assert.equal(queried.length, 2, '第二次就证明成功,不该再查第三次')
    assert.deepEqual(slept, [0], '只在两次复查之间等一次,间隔可注入')
    assert.equal(result.claimed[0].verified, true)
    assert.equal(result.claimed[0].via, 'status')
})

test('R1 第一次就查到:只查 1 次、不等、不发反证', async () => {
    let reclaims = 0
    const result = await verifyWeekly(CTX, weeklyWith(), deps({
        query: statusQuery(2),
        reclaim: async () => { reclaims++; return { ok: false, errcode: -1 } }
    }))
    assert.equal(result.claimed[0].verified, true)
    assert.equal(result.claimed[0].via, 'status')
    assert.equal(reclaims, 0)
})

test('R1 三次都查不到 → R2 反证 -2664 已领过:via=already', async () => {
    const queried = []
    const result = await verifyWeekly(CTX, weeklyWith(), deps({
        query: async () => { queried.push(1); return { ok: true, awards: [{ levelId: 13, status: 0 }] } },
        reclaim: reclaimWith({ ok: false, status: 499, errcode: -2664, alreadyClaimed: true })
    }))
    assert.equal(queried.length, 3, '复查固定 3 次')
    assert.equal(result.claimed[0].verified, true)
    assert.equal(result.claimed[0].via, 'already')
})

test('R2 反证 200/errcode 0:服务端此刻接受了领取,via=reclaim', async () => {
    const result = await verifyWeekly(CTX, weeklyWith(), deps({
        query: statusQuery(1),
        reclaim: reclaimWith({ ok: true, status: 200, errcode: 0, alreadyClaimed: false })
    }))
    assert.equal(result.claimed[0].verified, true)
    assert.equal(result.claimed[0].via, 'reclaim')
})

test('R2 反证返回其它错误码:保持未自证,via=null', async () => {
    const result = await verifyWeekly(CTX, weeklyWith(), deps({
        query: statusQuery(1),
        reclaim: reclaimWith({ ok: false, status: 499, errcode: -1, alreadyClaimed: false })
    }))
    assert.equal(result.claimed[0].verified, false)
    assert.equal(result.claimed[0].via, null)
})

test('R3 反证只针对本次刚领取的档位,不改写历史 alreadyClaimed', async () => {
    const seen = []
    const result = await verifyWeekly(CTX, weeklyWith(), deps({
        query: statusQuery(1),
        reclaim: async (_ctx, claim) => { seen.push(claim.levelId); return { ok: false, errcode: -2664, alreadyClaimed: true } }
    }))
    assert.deepEqual(seen, [13])
    assert.deepEqual(result.alreadyClaimed, [])
})

test('R1 查询抛错或查询失败都不放弃,继续下一次;最终能证明', async () => {
    let round = 0
    const result = await verifyWeekly(CTX, weeklyWith(), deps({
        query: async () => {
            round++
            if (round === 1) throw new Error('自证查询炸了')
            if (round === 2) return { ok: false, reason: 'query-failed' }
            return { ok: true, awards: [{ levelId: 13, status: 2 }] }
        }
    }))
    assert.equal(round, 3)
    assert.equal(result.claimed[0].via, 'status')
})

test('查询与反证都抛异常:不抛穿,按未自证处理,其余结果原样返回', async () => {
    const weekly = weeklyWith()
    const result = await verifyWeekly(CTX, weekly, deps({
        query: async () => { throw new Error('炸') },
        reclaim: async () => { throw new Error('也炸') }
    }))
    assert.equal(result.claimed[0].verified, false)
    assert.equal(result.claimed[0].via, null)
    assert.equal(result.readingSeconds, weekly.readingSeconds, '不影响运行结果与退出码')
})

test('无档位可领时一个多余请求都不发', async () => {
    let calls = 0
    const weekly = weeklyWith([])
    const result = await verifyWeekly(CTX, weekly, deps({
        query: async () => { calls++; return { ok: true, awards: [] } },
        reclaim: async () => { calls++; return { ok: false, errcode: -1 } }
    }))
    assert.equal(calls, 0)
    assert.equal(result, weekly)
})
