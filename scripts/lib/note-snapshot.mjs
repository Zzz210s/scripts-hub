// 笔记库快照:一个日期一个目录,里面放「能独立恢复」的最小集合。
//
//   <root>/<YYYY-MM-DD>/repo.bundle       git bundle --all:全部 refs 与历史,单文件可直接 clone
//   <root>/<YYYY-MM-DD>/worktree.tar.zst  工作区全量(只排除 .git):含未跟踪与被 .gitignore 的文件
//   <root>/<YYYY-MM-DD>/manifest.json     日期 / HEAD / refs / 文件数与字节 / sha256 / 保留策略
//
// 这些只是暂存件,长期载体是 restic(config/backup.json 的 notes-snapshot 集合)。
// 默认 dry-run,--apply 才写盘;制品先落 .tmp 再改名,manifest 最后写,中断不会留下半个快照。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { git, gitInfo, localDate, sha256File } from './note-git.mjs'
import { ARCHIVE_NAME, BUNDLE_NAME, DATE_DIR_RE, MANIFEST_NAME, listSnapshots, planPrune, slash } from './note-store.mjs'

/**
 * 递归哈希一个工作区:文件数、总字节、按「相对路径+sha256+字节」排序算出的整体摘要。
 * 只跳过指定目录名(默认 .git);符号链接与 junction 记为目标字符串,不再往下钻(防环)。
 */
export function walkHashes(root, { skipDirs = ['.git'] } = {}) {
    const skip = new Set(skipDirs)
    const rows = []
    const byPath = {}
    let bytes = 0
    let dirs = 0
    const stack = ['']
    while (stack.length) {
        const rel = stack.pop()
        for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
            const child = rel ? `${rel}/${entry.name}` : entry.name
            const full = path.join(root, child)
            const st = fs.lstatSync(full)
            if (st.isSymbolicLink()) {
                const sha = crypto.createHash('sha256').update(`link:${fs.readlinkSync(full)}`).digest('hex')
                rows.push([child, sha, 0])
                byPath[child] = { sha256: sha, bytes: 0, kind: 'link' }
            } else if (st.isDirectory()) {
                if (skip.has(entry.name)) continue
                dirs += 1
                stack.push(child)
            } else if (st.isFile()) {
                const sha = sha256File(full)
                rows.push([child, sha, st.size])
                byPath[child] = { sha256: sha, bytes: st.size, kind: 'file' }
                bytes += st.size
            }
        }
    }
    rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    const digest = crypto.createHash('sha256').update(rows.map((r) => r.join('\t')).join('\n')).digest('hex')
    return { root: path.resolve(root), files: rows.length, dirs, bytes, digest, byPath }
}

function zstdCompress(buf) {
    const level = zlib.constants.ZSTD_c_compressionLevel
    try {
        if (level !== undefined) return zlib.zstdCompressSync(buf, { params: { [level]: 12 } })
    } catch { /* 该构建不支持 params,落回默认档 */ }
    return zlib.zstdCompressSync(buf)
}

/** 写出 repo.bundle(先 .tmp 再改名并 verify),返回字节数。 */
export function createBundle(gitDir, outFile) {
    const tmp = `${outFile}.tmp`
    git(['bundle', 'create', tmp, '--all'], gitDir)
    git(['bundle', 'verify', tmp], gitDir)
    fs.renameSync(tmp, outFile)
    return fs.statSync(outFile).size
}

/** 写出 worktree.tar.zst(先 tar 再 zstd,只排除顶层 .git),返回体积与工作区统计。 */
export function createWorktreeArchive(src, outFile, { skipDirs = ['.git'] } = {}) {
    const tarFile = `${outFile}.tmp.tar`
    const excludes = skipDirs.map((d) => `--exclude=./${d}`)
    const r = spawnSync('tar', ['--force-local', '-cf', slash(tarFile), ...excludes, '-C', slash(src), '.'], { encoding: 'utf8', windowsHide: true })
    if (r.status !== 0) throw new Error(`tar 打包失败:${(r.stderr || r.error?.message || '').trim()}`)
    const worktree = walkHashes(src, { skipDirs })
    fs.writeFileSync(`${outFile}.tmp`, zstdCompress(fs.readFileSync(tarFile)))
    fs.rmSync(tarFile)
    fs.renameSync(`${outFile}.tmp`, outFile)
    return { bytes: fs.statSync(outFile).size, worktree }
}

/**
 * 生成一份快照。bundleFrom 指定「从哪个 git 目录取历史」(默认真源仓库,可指向旧 bare 镜像),
 * worktreeFrom 指定「从哪个目录取工作区」,legacyMeta 指定「额外原样收进 legacy-meta/ 的目录」(迁移旧件用)。
 */
export function buildSnapshot({ repo, root, date, keep = 3, dryRun = true, bundleFrom = null, worktreeFrom = null, legacyMeta = null, prune = true }) {
    const day = date ?? localDate()
    if (!DATE_DIR_RE.test(day)) throw new Error(`日期要 YYYY-MM-DD:${day}`)
    const gitDir = bundleFrom ?? repo
    const treeDir = worktreeFrom ?? repo
    const dir = path.join(root, day)
    const plan = {
        date: day,
        dir,
        gitDir: path.resolve(gitDir),
        treeDir: path.resolve(treeDir),
        keep,
        bundle: path.join(dir, BUNDLE_NAME),
        archive: path.join(dir, ARCHIVE_NAME),
        manifest: path.join(dir, MANIFEST_NAME),
        info: gitInfo(gitDir),
        treeInfo: worktreeFrom ? gitInfo(worktreeFrom) : null,
        worktree: walkHashes(treeDir),
        legacyMeta: legacyMeta ? path.resolve(legacyMeta) : null
    }
    const pending = planPrune(listSnapshots(root).map((s) => s.date), keep)
    if (dryRun) return { ok: true, dryRun, plan, prune: prune ? pending : [] }

    fs.mkdirSync(dir, { recursive: true })
    const bundleBytes = createBundle(gitDir, plan.bundle)
    const { bytes: archiveBytes, worktree } = createWorktreeArchive(treeDir, plan.archive)
    const legacy = []
    if (legacyMeta) {
        const dest = path.join(dir, 'legacy-meta')
        fs.mkdirSync(dest, { recursive: true })
        for (const name of fs.readdirSync(legacyMeta)) {
            const from = path.join(legacyMeta, name)
            if (!fs.statSync(from).isFile()) continue
            fs.copyFileSync(from, path.join(dest, name))
            legacy.push({ name: `legacy-meta/${name}`, bytes: fs.statSync(from).size, sha256: sha256File(from) })
        }
    }
    const manifest = {
        version: 1,
        kind: 'note-snapshot',
        date: day,
        createdAt: new Date().toISOString(),
        artifacts: [
            { name: BUNDLE_NAME, bytes: bundleBytes, sha256: sha256File(plan.bundle) },
            { name: ARCHIVE_NAME, bytes: archiveBytes, sha256: sha256File(plan.archive) }
        ],
        git: { ...plan.info, bundleFrom: plan.gitDir, worktreeFrom: plan.treeDir, worktreeStatus: plan.treeInfo?.status ?? plan.info.status ?? null, worktreeStatusCounts: plan.treeInfo?.statusCounts ?? plan.info.statusCounts ?? null },
        worktree: { files: worktree.files, dirs: worktree.dirs, bytes: worktree.bytes, digest: worktree.digest, excludeDirs: ['.git'] },
        legacyMeta: legacy,
        retention: { keep, rule: '只保留最近 N 个日期目录;legacy/ 与其它条目不动' },
        restore: 'node scripts/note-snapshot.mjs --restore <本目录> --to <目标目录>'
    }
    fs.writeFileSync(plan.manifest, JSON.stringify(manifest, null, 2) + '\n')
    const pruned = []
    if (prune) {
        for (const name of pending) {
            fs.rmSync(path.join(root, name), { recursive: true, force: true })
            pruned.push(name)
        }
    }
    return { ok: true, dryRun: false, dir, plan, manifest, pruned }
}
