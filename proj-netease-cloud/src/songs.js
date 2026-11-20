// 曲目池:从搜索接口捞**免费**曲目(fee=0),按 id 去重后落盘缓存。
//
// 为什么要筛 fee:2026-11-20 实测,「我喜欢」里 621 首全是 fee=1/8 的付费内容,
// 网页端连 audio 元素都不创建;搜索「纯音乐」30 首里有 7 首 fee=0,这类才有可能真播。
//
// 池子是「只增不改」的:每次运行顺手补一批新歌,已有的保留 —— 听歌量要的是不重样的曲目。
import fs from 'node:fs'
import path from 'node:path'

import { call } from './client.js'

/** 拉一批候选再逐个查版权字段;只留 fee === 0 且 st === 0 的。 */
export async function searchFreeSongs({ keyword, cookie, limit = 30, deps = {} } = {}) {
    const found = await call({
        url: '/weapi/cloudsearch/get/web',
        crypto: 'weapi',
        data: { s: keyword, type: 1, limit, offset: 0 },
        cookie,
        deps
    })
    if (!found.ok) return { ok: false, songs: [], reason: found.reason }
    const ids = (found.body?.result?.songs ?? []).map((song) => Number(song.id)).filter(Number.isFinite)
    if (!ids.length) return { ok: true, songs: [], reason: 'ok' }

    const detail = await call({
        url: '/weapi/v3/song/detail',
        crypto: 'weapi',
        data: { c: JSON.stringify(ids.map((id) => ({ id }))) },
        cookie,
        deps
    })
    if (!detail.ok) return { ok: false, songs: [], reason: detail.reason }
    const songs = (detail.body?.songs ?? [])
        .filter((song) => Number(song.fee) === 0 && Number(song.st) === 0)
        .map((song) => ({ id: Number(song.id), name: String(song.name ?? '').slice(0, 40) }))
    return { ok: true, songs, reason: 'ok' }
}

export function readPool(file, { fsImpl = fs } = {}) {
    try {
        const parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'))
        const songs = Array.isArray(parsed?.songs) ? parsed.songs : []
        return songs.filter((song) => Number.isFinite(Number(song.id)))
    } catch {
        return []
    }
}

/** 合并去重,返回「这次真正新增了多少」。 */
export function mergePool(pool, incoming) {
    const seen = new Set(pool.map((song) => Number(song.id)))
    const added = []
    for (const song of incoming) {
        const id = Number(song.id)
        if (!Number.isFinite(id) || seen.has(id)) continue
        seen.add(id)
        added.push({ id, name: String(song.name ?? '') })
    }
    return { pool: [...pool, ...added], added: added.length }
}

export function writePool(file, songs, { fsImpl = fs } = {}) {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true })
    fsImpl.writeFileSync(file, JSON.stringify({ songs }, null, 2), 'utf8')
}
