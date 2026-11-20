// 填充器:在别的程序不跑的窗口里,随机播不重样的免费曲目,顺手记录听歌量有没有涨。
//
// 现状(2026-11-20 实测):网页播放器在本机环境里被服务端以 400 拒掉,`audio` 元素不创建,
// 所以「真播放」这条暂时走不通。本模块先把**上报链路 + 台账 + 读回验证**搭好:
// 一旦明天 14:05 的读数证明打点有效,这里换个上报实现就能直接产出效果;
// 若证明无效,至少台账与读回能告诉我们「发了多少、涨了没有」。
//
// 它只做三件事:挑歌 → 上报 → 读回。不发消息(消息由 run.js 的日报统一管)。
import fs from 'node:fs'
import path from 'node:path'

import { call } from './client.js'
import { pace } from './pacing.js'
import { pickBatch } from './fill-plan.js'
import { mergePool, readPool, searchFreeSongs, writePool } from './songs.js'

export const DEFAULTS = {
    countPerRun: 20,
    maxPerDay: 60,
    poolTarget: 200,
    keywords: ['纯音乐', '轻音乐', '钢琴', '古典', '民谣', '原声']
}

/** 读听歌量。读不到给 null —— 绝不拿 0 冒充。 */
export async function readPlayCount({ cookie, deps = {} } = {}) {
    const res = await call({ url: '/weapi/user/level', crypto: 'weapi', data: {}, cookie, deps })
    if (!res.ok) return { ok: false, playCount: null, reason: res.reason }
    const data = res.body?.data ?? {}
    const value = Number(data.nowPlayCount)
    return {
        ok: Number.isFinite(value),
        playCount: Number.isFinite(value) ? value : null,
        nextPlayCount: Number(data.nextPlayCount) || null,
        level: Number(data.level) || null,
        reason: 'ok'
    }
}

/** 上报一首歌的播放。返回是否被服务端接受;接受不等于计数,计数要看第二天读回。 */
export async function reportPlay({ songId, cookie, seconds = 240, deps = {} } = {}) {
    const url = await call({
        url: '/weapi/song/enhance/player/url/v1',
        crypto: 'weapi',
        data: { ids: JSON.stringify([songId]), level: 'standard', encodeType: 'aac' },
        cookie,
        deps
    })
    const playable = Boolean(url.body?.data?.[0]?.url)
    const logs = JSON.stringify([
        {
            action: 'play',
            json: {
                id: songId,
                type: 'song',
                time: seconds,
                end: 'playend',
                source: 'list',
                sourceId: 'list',
                wifi: 0,
                download: 0,
                bitrate: 320000,
                playType: 'normal'
            }
        }
    ])
    const res = await call({
        url: 'https://clientlogusf.music.163.com/weapi/feedback/weblog',
        crypto: 'weapi',
        data: { logs },
        cookie,
        deps
    })
    return { ok: res.ok && playable, playable, code: res.code ?? null, reason: res.reason }
}

/** 池子不够就补:逐个关键词拉,合并去重,落盘。返回池子大小。 */
export async function ensurePool({ cwd, cookie, target, keywords, deps = {}, log = () => {} } = {}) {
    const file = `${cwd}/data/pool.json`
    let pool = readPool(file)
    if (pool.length >= target) return { pool, added: 0 }
    for (const keyword of keywords) {
        if (pool.length >= target) break
        const found = await searchFreeSongs({ keyword, cookie, deps })
        if (!found.ok) {
            log(`[填充] 拉取「${keyword}」失败:${found.reason}`)
            continue
        }
        const merged = mergePool(pool, found.songs)
        pool = merged.pool
        log(`[填充] 「${keyword}」+${merged.added} 首 · 池子 ${pool.length}`)
        await pace(deps)
    }
    writePool(file, pool)
    return { pool, added: pool.length }
}

/**
 * 跑一批。deps 可注入 sleep/call 供离线测试。
 * 返回 { ok, played, before, after, reason }。
 */
export async function runFill({ cwd = '.', cookie, config = {}, deps = {}, log = () => {}, dryRun = false } = {}) {
    const count = Number(config.countPerRun ?? DEFAULTS.countPerRun)
    const today = config.today
    const before = await readPlayCount({ cookie, deps })
    log(`[填充] 起始听歌量 ${before.playCount ?? '未知'}`)

    const { pool } = await ensurePool({
        cwd,
        cookie,
        target: Number(config.poolTarget ?? DEFAULTS.poolTarget),
        keywords: config.keywords ?? DEFAULTS.keywords,
        deps,
        log
    })
    const ledgerFile = `${cwd}/data/fill-ledger.json`
    const ledger = readLedger(ledgerFile)
    const batch = pickBatch({ pool, played: ledger.played ?? {}, today, count, seed: Number(today.replace(/\D/g, '')) })
    log(`[填充] 池子 ${pool.length} 首 · 本批 ${batch.length} 首 · 今日已播 ${ledger.days?.[today] ?? 0}`)

    if (dryRun) return { ok: true, dryRun: true, played: [], before, after: before, batch }
    if (!batch.length) return { ok: true, played: [], before, after: before, batch, reason: 'no-songs' }

    const played = []
    for (const song of batch) {
        const sent = await reportPlay({ songId: song.id, cookie, deps })
        if (sent.ok) {
            played.push(song.id)
            ledger.played = { ...(ledger.played ?? {}), [song.id]: today }
            ledger.days = { ...(ledger.days ?? {}), [today]: (ledger.days?.[today] ?? 0) + 1 }
            writeLedger(ledgerFile, ledger)
            log(`[填充] ${song.id} 已上报 · ${song.name.slice(0, 16)}`)
        } else {
            log(`[填充] ${song.id} 上报失败 · ${sent.reason} · 可播放=${sent.playable}`)
        }
        await pace(deps)
    }
    const after = await readPlayCount({ cookie, deps })
    log(`[填充] 结束听歌量 ${after.playCount ?? '未知'} · 本批 ${played.length} 首`)
    return { ok: true, played, before, after, batch, gained: delta(before.playCount, after.playCount) }
}

/** 读回增量;任一为 null 就返回 null,不猜。 */
export function delta(from, to) {
    return Number.isFinite(from) && Number.isFinite(to) ? to - from : null
}

export function readLedger(file) {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

/** 原子落盘:台账丢了会导致同一批歌明天又被当成「没播过」。 */
export function writeLedger(file, ledger) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8')
    fs.renameSync(tmp, file)
}
