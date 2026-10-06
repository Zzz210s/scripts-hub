// 笔记库快照用到的 git 读写:命令包装、文件哈希、本机日期、仓库元信息。
// 与「怎么造快照」分开(见 note-snapshot.mjs),这样 drill 与 store 也能共用同一套语义。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

/** git 包装:非零退出即抛,stderr 带进错误信息。 */
export function git(args, cwd) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} 退出码 ${r.status}:${(r.stderr || r.error?.message || '').trim()}`)
    return r.stdout ?? ''
}

/** 单个文件的 sha256。 */
export function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** 本机日期 YYYY-MM-DD(本地时区,不用 toISOString —— 那会按 UTC 跨日)。 */
export function localDate(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const countStatus = (lines) => {
    const out = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, other: 0 }
    for (const l of lines ?? []) {
        const [x, y] = [l[0], l[1]]
        if (x === '?' && y === '?') out.untracked += 1
        else if (x === 'R' || y === 'R') out.renamed += 1
        else if (x === 'A') out.added += 1
        else if (x === 'D' || y === 'D') out.deleted += 1
        else if (x === 'M' || y === 'M') out.modified += 1
        else out.other += 1
    }
    return out
}

/** 仓库元信息。bare 镜像没有工作区,status 记 null(要工作区状态就另传一个工作区目录)。 */
export function gitInfo(repo) {
    const bare = git(['rev-parse', '--is-bare-repository'], repo).trim() === 'true'
    const refs = {}
    for (const line of git(['show-ref'], repo).trim().split('\n').filter(Boolean)) {
        const [sha, ref] = line.split(' ')
        refs[ref] = sha
    }
    let origin = null
    try { origin = git(['config', '--get', 'remote.origin.url'], repo).trim() } catch { /* 无远端 */ }
    const info = {
        repo: path.resolve(repo),
        bare,
        head: git(['rev-parse', 'HEAD'], repo).trim(),
        branch: bare ? null : git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim(),
        origin,
        refs,
        commits: Number(git(['rev-list', '--count', '--all'], repo).trim()),
        status: null
    }
    if (!bare) {
        info.status = git(['-c', 'core.quotepath=false', 'status', '--porcelain', '-uall'], repo).split('\n').map((s) => s.trimEnd()).filter(Boolean)
        info.statusCounts = countStatus(info.status)
    }
    return info
}
