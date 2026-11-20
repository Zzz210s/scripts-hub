// 挑歌:今天还没播过的那批,随机但不重样。
//
// 「不重样」有两层:
//   1. 同一批里不重复 —— 一次运行内部 shuffle 后顺序取;
//   2. 跨批不重复 —— 台账记下每首歌是哪天播的,当天播过的不再进候选。
// 曲目池用完则按「最久没播过」优先回收,否则池子只有几十首时会立刻无歌可播。

/** 简单的可复现洗牌:同样的 seed 给同样的顺序,便于事后复现一次运行。 */
export function shuffle(list, seed = 0) {
    const out = [...list]
    let state = (Number(seed) || 1) >>> 0
    for (let i = out.length - 1; i > 0; i--) {
        state = (state * 1664525 + 1013904223) >>> 0
        const j = state % (i + 1)
        ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
}

/**
 * 从池子里挑 count 首。
 * @param pool     [{ id, name }]
 * @param played   { [songId]: 最后播放的日期 'YYYY-MM-DD' }
 * @param today    'YYYY-MM-DD'
 * @param count    这次要几首
 * @param seed     洗牌种子,一般用「日期 + 当天第几批」
 */
export function pickBatch({ pool = [], played = {}, today, count = 20, seed = 0 } = {}) {
    const fresh = []
    const stale = []
    for (const song of pool) {
        const id = Number(song?.id)
        if (!Number.isFinite(id)) continue
        const last = played[id] ?? played[String(id)]
        if (last === today) continue // 今天已经播过,绝不再来一次
        if (!last) fresh.push({ id, name: song.name ?? '' })
        else stale.push({ id, name: song.name ?? '', last })
    }
    // 优先没播过的;不够再用「最久没播」的补
    stale.sort((a, b) => String(a.last).localeCompare(String(b.last)))
    const ordered = [...shuffle(fresh, seed), ...stale.map(({ id, name }) => ({ id, name }))]
    return ordered.slice(0, Math.max(0, count))
}
