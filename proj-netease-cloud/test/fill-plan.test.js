// 挑歌与池子的离线测试:不起网络,全部用桩。
import assert from 'node:assert/strict'
import test from 'node:test'

import { pickBatch, shuffle } from '../src/fill-plan.js'
import { mergePool, readPool } from '../src/songs.js'

const pool = [
    { id: 1, name: 'a' },
    { id: 2, name: 'b' },
    { id: 3, name: 'c' },
    { id: 4, name: 'd' }
]

test('今天播过的不进候选,哪怕池子只剩它', () => {
    const played = { 1: '2026-11-20', 2: '2026-11-20', 3: '2026-11-20', 4: '2026-11-20' }
    const batch = pickBatch({ pool, played, today: '2026-11-20', count: 10 })
    assert.deepEqual(batch, [])
})

test('跨天可以再用,但优先没播过的', () => {
    const played = { 1: '2026-11-19', 2: '2026-11-19' }
    const batch = pickBatch({ pool, played, today: '2026-11-20', count: 4 })
    assert.equal(batch.length, 4)
    // 前两个必须是没播过的 3 和 4
    assert.deepEqual(batch.slice(0, 2).map((one) => one.id).sort(), [3, 4])
})

test('池子不够就给多少算多少,不循环重复填充', () => {
    const batch = pickBatch({ pool: pool.slice(0, 2), played: {}, today: '2026-11-20', count: 10 })
    assert.equal(batch.length, 2)
    assert.equal(new Set(batch.map((one) => one.id)).size, 2)
})

test('同样的种子给同样的顺序,便于复现', () => {
    assert.deepEqual(shuffle([1, 2, 3, 4, 5], 42), shuffle([1, 2, 3, 4, 5], 42))
    assert.notDeepEqual(shuffle([1, 2, 3, 4, 5], 42), shuffle([1, 2, 3, 4, 5], 7))
})

test('字符串 id 与数字 id 视为同一首,不会被重复挑中', () => {
    const batch = pickBatch({
        pool: [{ id: '9', name: 'x' }],
        played: { 9: '2026-11-20' },
        today: '2026-11-20',
        count: 5
    })
    assert.deepEqual(batch, [])
})

test('合并池子按 id 去重并报告新增数量', () => {
    const merged = mergePool(pool, [
        { id: 4, name: 'd-重复' },
        { id: 5, name: 'e' },
        { id: 'x', name: '非法' }
    ])
    assert.equal(merged.added, 1)
    assert.equal(merged.pool.length, 5)
})

test('池子文件不存在或坏掉时给空数组,不抛', () => {
    assert.deepEqual(readPool('/nonexistent/pool.json'), [])
})
