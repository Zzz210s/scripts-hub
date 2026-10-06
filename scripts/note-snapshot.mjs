#!/usr/bin/env node
// 笔记库快照:一个日期一个目录(repo.bundle + worktree.tar.zst + manifest.json),由 restic 统一推走。
//
//   node scripts/note-snapshot.mjs                     # 默认 --dry-run:显示计划与保留策略,不写盘
//   node scripts/note-snapshot.mjs --apply             # 生成 <root>/<今天>/;成功后才清理超期日期目录
//   node scripts/note-snapshot.mjs --apply --no-prune   # 只生成,不清理旧日期目录
//   node scripts/note-snapshot.mjs --list              # 列出已有快照(日期 / HEAD / 体积 / 制品)
//   node scripts/note-snapshot.mjs --drill             # 恢复演练最新一份(克隆 + fsck + 解包 + 逐文件比对)
//   node scripts/note-snapshot.mjs --drill=2026-10-05 --source=<旧工作区副本>   # 加一重逐文件对照
//   node scripts/note-snapshot.mjs --restore <快照目录> --to <目标目录>   # 真恢复成一份可用工作区
//
// 迁移旧件:--bundle-from 指向旧 bare 镜像、--worktree-from 指向旧工作区副本、--legacy-meta 收走旧的清单类文件。
// 根目录取 %NOTE_BACKUP_ROOT%(环境变量或 ~/.config/automation-suite/local-paths.env)。
import fs from 'node:fs'
import path from 'node:path'
import { expandPath, human, placeholderValues } from './lib/backup.mjs'
import { listSnapshots, restoreSnapshot } from './lib/note-store.mjs'
import { localDate } from './lib/note-git.mjs'
import { buildSnapshot } from './lib/note-snapshot.mjs'
import { drillSnapshot } from './lib/note-drill.mjs'

const args = process.argv.slice(2)
const has = (n) => args.includes(n)
const hasFlag = (n) => args.some((a) => a === n || a.startsWith(`${n}=`))
const value = (n) => args.find((a) => a.startsWith(`${n}=`))?.slice(n.length + 1)
const positional = args.filter((a) => !a.startsWith('-'))
const wantJson = has('--json')
const say = (s) => process.stdout.write(`${s}\n`)

const rawRoot = value('--root') ?? '%NOTE_BACKUP_ROOT%'
const root = expandPath(rawRoot, placeholderValues())
if (/%[A-Z_]+%/.test(root)) {
    process.stderr.write(`[失败] 根目录没配:${rawRoot}\n       在 ~/.config/automation-suite/local-paths.env 写 NOTE_BACKUP_ROOT=<盘>:/note-backups,或用 --root=<路径> / 环境变量。\n`)
    process.exit(2)
}
const keep = Number(value('--keep') ?? 3)
const source = value('--source') ?? null
const fail = (msg) => { process.stderr.write(`[失败] ${msg}\n`); process.exit(2) }

if (has('--list')) {
    const snaps = listSnapshots(root)
    if (wantJson) say(JSON.stringify(snaps, null, 2))
    else if (!snaps.length) say(`还没有快照:${root}`)
    else {
        say(`快照根目录:${root}`)
        for (const s of snaps) say(`  ${s.date}  HEAD ${String(s.head).slice(0, 12)}  ${human(s.bytes)}  [${s.files.join(' ')}]`)
        const extra = fs.existsSync(root) ? fs.readdirSync(root).filter((n) => !/^\d{4}-\d{2}-\d{2}$/.test(n)) : []
        if (extra.length) say(`  非日期条目(${extra.length}):${extra.join(' ')}`)
    }
    process.exit(0)
}

if (hasFlag('--restore')) {
    const dir = path.resolve(value('--restore') ?? positional[0] ?? '')
    const to = value('--to') ?? positional[1]
    if (!fs.existsSync(dir)) fail(`快照目录不存在:${dir}`)
    if (!to) fail('--restore 需要 --to=<目标目录>')
    restoreSnapshot(dir, path.resolve(to))
    say(`[恢复完成] ${dir} -> ${path.resolve(to)}`)
    process.exit(0)
}

if (hasFlag('--drill')) {
    const pick = value('--drill')
    const snaps = listSnapshots(root)
    const dir = pick ? (/^\d{4}-\d{2}-\d{2}$/.test(pick) ? path.join(root, pick) : path.resolve(pick)) : snaps[0]?.dir
    if (!dir || !fs.existsSync(dir)) fail(`没有可演练的快照(根目录 ${root})`)
    say(`恢复演练:${dir}${source ? `\n对照源工作区:${path.resolve(source)}` : '(不给 --source 时只对照清单)'}`)
    const result = drillSnapshot({ dir, source, keepTmp: has('--keep-tmp') })
    for (const line of result.log) say(`  ${line}`)
    if (wantJson) say(JSON.stringify(result, null, 2))
    for (const c of result.checks) say(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.name} —— ${c.detail}`)
    say(result.ok ? '演练结论:通过(快照可独立恢复出一份可用工作区)' : '演练结论:不通过(不要删任何旧件)')
    process.exit(result.ok ? 0 : 1)
}

const bundleFrom = value('--bundle-from') ?? null
const worktreeFrom = value('--worktree-from') ?? null
const legacyMeta = value('--legacy-meta') ?? null
const repo = value('--repo') ?? expandPath('%NOTES_DIR%', placeholderValues())
if (bundleFrom && !bundleFrom.endsWith('.git') && !fs.existsSync(path.join(path.resolve(bundleFrom), 'HEAD'))) {
    fail(`--bundle-from 不像 git 目录(缺 HEAD):${bundleFrom}`)
}
const plan = { repo, root, date: value('--date') ?? localDate(), keep, dryRun: !has('--apply'), bundleFrom, worktreeFrom, legacyMeta, prune: !has('--no-prune') }

if (!wantJson) {
    say(`笔记库快照${plan.dryRun ? '(dry-run)' : '(apply)'}`)
    say(`  历史来源 : ${path.resolve(bundleFrom ?? repo)}`)
    say(`  工作区源 : ${path.resolve(worktreeFrom ?? repo)}`)
    say(`  输出目录 : ${path.join(root, plan.date)}`)
    say(`  制品     : repo.bundle(git bundle --all) + worktree.tar.zst(排除 .git) + manifest.json`)
    say(`  保留策略 : 最近 ${keep} 个日期目录,更旧的整目录删除(legacy/ 不动)`)
    if (legacyMeta) say(`  旧清单   : ${path.resolve(legacyMeta)} -> legacy-meta/`)
}
const result = buildSnapshot(plan)
if (wantJson) { say(JSON.stringify(result, null, 2)); process.exit(0) }
if (result.dryRun) {
    const p = result.plan
    say(`  计划哈希 : ${p.worktree.files} 个文件 / ${human(p.worktree.bytes)},HEAD ${p.info.head.slice(0, 12)},${p.info.commits} 个提交`)
    if (p.info.status?.length) say(`  当前未提交:${p.info.status.length} 条(git status --porcelain)`)
    if (result.prune.length) say(`  将会清理 : ${result.prune.join(', ')}`)
    say('这是 --dry-run:没有写任何文件。加 --apply 才生成快照。')
    process.exit(0)
}
say(`[快照完成] ${result.dir}`)
for (const a of result.manifest.artifacts) say(`  ${a.name}  ${human(a.bytes)}  sha256=${a.sha256.slice(0, 16)}...`)
say(`  worktree  ${result.manifest.worktree.files} 个文件 / ${human(result.manifest.worktree.bytes)} / digest ${result.manifest.worktree.digest.slice(0, 12)}`)
if (result.manifest.legacyMeta.length) say(`  legacy-meta  ${result.manifest.legacyMeta.length} 个文件`)
if (result.pruned.length && !has('--no-prune')) say(`[清理] 超出保留策略,已删除:${result.pruned.join(', ')}`)
say(`下一步:node scripts/note-snapshot.mjs --drill=${plan.date}`)
