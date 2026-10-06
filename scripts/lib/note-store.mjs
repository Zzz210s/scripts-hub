// 快照目录的读写:命名规则、列出、保留策略、恢复。与「怎么造快照」分开(见 note-snapshot.mjs)。
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'

export const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/
export const BUNDLE_NAME = 'repo.bundle'
export const ARCHIVE_NAME = 'worktree.tar.zst'
export const MANIFEST_NAME = 'manifest.json'

/** tar 在 Windows 上把反斜杠当转义字符,路径统一转成正斜杠再喂给它。 */
export const slash = (p) => String(p).replace(/\\/g, '/')

/** 保留策略:日期目录按新到旧排,超出 keep 的要删。纯函数,便于测试。 */
export function planPrune(names, keep) {
    const dated = names.filter((n) => DATE_DIR_RE.test(n)).sort((a, b) => (a < b ? 1 : -1))
    return dated.slice(Math.max(keep, 1))
}

/** 列出现有快照(日期目录);manifest 缺失或损坏也照样列出,只把 manifest 记 null。 */
export function listSnapshots(root) {
    if (!fs.existsSync(root)) return []
    return fs.readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && DATE_DIR_RE.test(e.name))
        .map((e) => {
            const dir = path.join(root, e.name)
            let manifest = null
            try { manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_NAME), 'utf8')) } catch { /* 半成品或手工放置 */ }
            const files = fs.readdirSync(dir)
            return {
                date: e.name,
                dir,
                manifest,
                head: manifest?.git?.head ?? null,
                bytes: files.reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0),
                files
            }
        })
        .sort((a, b) => (a.date < b.date ? 1 : -1))
}

/** 恢复:把快照里的历史与工作区合到 dest(与恢复演练走同一条路径)。dest 需为空/不存在。
 * 用 --no-checkout 克隆(否则 HEAD 里那些在快照时已从磁盘删除的文件会被检出,恢复出的工作区就不等于快照时的状态),
 * 解包后再 git reset 把索引刷回 HEAD,这样 git status 看到的就是「快照时的工作区 vs HEAD」。
 */
export function restoreSnapshot(dir, dest) {
    const bundle = path.join(dir, BUNDLE_NAME)
    const archive = path.join(dir, ARCHIVE_NAME)
    for (const f of [bundle, archive]) if (!fs.existsSync(f)) throw new Error(`缺制品:${f}`)
    fs.mkdirSync(dest, { recursive: true })
    const cl = spawnSync('git', ['clone', '--quiet', '--no-checkout', slash(bundle), slash(dest)], { encoding: 'utf8', windowsHide: true })
    if (cl.status !== 0) throw new Error(`克隆 bundle 失败:${(cl.stderr || '').trim()}`)
    const tarFile = path.join(dest, '.worktree.tar')
    fs.writeFileSync(tarFile, zlib.zstdDecompressSync(fs.readFileSync(archive)))
    const r = spawnSync('tar', ['--force-local', '-xf', slash(tarFile), '-C', slash(dest)], { encoding: 'utf8', windowsHide: true })
    fs.rmSync(tarFile)
    if (r.status !== 0) throw new Error(`解包失败:${(r.stderr || '').trim()}`)
    spawnSync('git', ['reset', '--quiet'], { cwd: dest, encoding: 'utf8', windowsHide: true })
    return dest
}
