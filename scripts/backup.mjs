#!/usr/bin/env node
// 多机异地备份:把「没有远端副本」的东西列清楚,并(可选)交给 restic 推走。
//
//   node scripts/backup.mjs                      # 默认 --dry-run:只枚举本机,不装 restic 也能跑
//   node scripts/backup.mjs --list               # 看清单里有哪些集合(本机 + 云上)
//   node scripts/backup.mjs --json               # 机器可读
//   node scripts/backup.mjs --set=notes          # 只看一个本机集合
//   node scripts/backup.mjs --include-optional   # 连 optional 集合一起枚举
//   node scripts/backup.mjs --strict             # 有任何本机路径缺失就退出 1
//   node scripts/backup.mjs --remote             # 通过 SSH 只读枚举云上目录(不加则只列计划)
//   node scripts/backup.mjs --prepare            # 只跑 prepare(VACUUM INTO 快照),不碰 restic
//   node scripts/backup.mjs --pull               # 打印从云上拉取的 rsync 命令(配合 --apply 才真拉)
//   node scripts/backup.mjs --apply              # 真备份,需要 restic + 仓库参数
//
// --apply 的仓库与密码来自 config/backup.json 的 restic 段,或环境变量
// RESTIC_REPOSITORY / RESTIC_PASSWORD_FILE。缺任一就拒绝执行(不猜、不落默认路径)。
// 跨机器/跨 provider 的目标选型与云主机两种模式(云上跑 / 本机拉)见 docs/infrastructure.md。
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { human, inspect, loadManifest, totals, unresolved } from './lib/backup.mjs'
import { enumerateRemote, expandRemote, pullCommands, remoteTotals } from './lib/backup-remote.mjs'
import { runPrepare } from './lib/backup-prepare.mjs'

const REPO_DIR = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const value = (name) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)

const manifestFile = path.resolve(value('--config') ?? path.join(REPO_DIR, 'config', 'backup.json'))
const manifest = loadManifest(manifestFile)
const remote = expandRemote(manifest)
const wantJson = has('--json')
const wantApply = has('--apply')
const wantRemote = has('--remote')
const wantPull = has('--pull')
const includeOptional = has('--include-optional')
const only = value('--set') ?? null
const strict = has('--strict')
const stageDir = value('--stage') ?? path.join(os.homedir(), '.local', 'share', 'automation-suite', 'backup-staging', 'remote')

if (only && !manifest.sets.some((s) => s.id === only)) {
    process.stderr.write(`[失败] 本机清单里没有集合 ${only}(可用:${manifest.sets.map((s) => s.id).join(', ')})\n`)
    process.exit(2)
}

const rows = inspect(manifest, { includeOptional, only })
const sum = totals(rows)
const leftOver = unresolved(rows.flatMap((r) => r.paths ?? []))
const offset = (n) => String(n).padStart(7)

if (leftOver.length) {
    process.stderr.write(
        `[警告] 这些占位符没有值,对应的路径会按字面量找不到:${leftOver.join(', ')}\n` +
        '       填 ~/.config/automation-suite/local-paths.env(模板 scripts/local-paths.env.example)或设同名环境变量。\n'
    )
}

if (has('--list')) {
    for (const set of manifest.sets) {
        const flag = set.optional ? ' (optional,默认跳过)' : ''
        process.stdout.write(`${set.priority.padEnd(8)} ${set.id}${flag}\n    ${set.why}\n    ${set.paths.length} 个来源\n`)
    }
    if (remote) {
        process.stdout.write(`\n云主机来源:${remote.label}(ssh ${remote.ssh})\n`)
        for (const set of remote.sets) {
            process.stdout.write(`${set.priority.padEnd(8)} ${set.id}\n    ${set.why}\n    ${set.absolutePaths.length} 个来源\n`)
        }
    }
    process.exit(0)
}

const probe = remote && wantRemote ? enumerateRemote(remote) : null

if (wantJson) {
    process.stdout.write(JSON.stringify({
        manifest: manifestFile,
        totals: sum,
        sets: rows,
        remote: remote ? { ...remote, ok: probe?.ok ?? null, error: probe?.error ?? null, rows: probe?.rows ?? null } : null
    }, null, 2) + '\n')
    process.exit(strict && sum.missing > 0 ? 1 : 0)
}

process.stdout.write(`备份清单:${manifestFile}\n`)
for (const row of rows) {
    const shown = includeOptional || !row.optional
    const head = row.skipped ? `${row.id} —— 跳过(optional,加 --include-optional 才枚举)` : row.id
    process.stdout.write(`\n== ${head} [${row.priority}] ==\n   ${row.why}\n`)
    if (!shown) continue
    for (const entry of row.entries) {
        if (!entry.exists) { process.stdout.write(`   缺失  ${entry.path}\n`); continue }
        const detail = entry.kind === 'file' ? '1 个文件' : `${entry.files} 个文件 / ${entry.dirs} 个目录`
        const note = entry.deep === false ? ' (有目录读不动,权限)' : ''
        process.stdout.write(`   ${offset(human(entry.bytes))}  ${detail}${note}\n            ${entry.path}\n`)
    }
}

if (remote) {
    process.stdout.write(`\n===== 云主机来源:${remote.label} =====\n    主机:${remote.ssh}${remote.unresolvedHost ? ' (占位符没值)' : ''}\n`)
    if (remote.unresolvedHost) {
        process.stderr.write('[警告] 远程主机占位符没值:在 ~/.config/automation-suite/local-paths.env 里填 BACKUP_REMOTE_SSH,否则 --remote/--pull 都用不了。\n')
    } else if (wantRemote && probe && !probe.ok) {
        process.stderr.write(`[警告] 远端枚举失败:${probe.error}\n`)
    }
    for (const set of remote.sets) {
        process.stdout.write(`\n== ${set.id} [${set.priority}] ==\n   ${set.why}\n`)
        const entries = probe?.ok ? probe.rows.find((r) => r.id === set.id)?.entries : null
        for (const [i, p] of set.absolutePaths.entries()) {
            const e = entries?.[i]
            if (!e) { process.stdout.write(`   计划  ${p}\n`); continue }
            if (!e.exists) { process.stdout.write(`   缺失  ${p}\n`); continue }
            const detail = e.kind === 'file' ? '1 个文件' : `${e.files} 个文件 / ${e.dirs} 个目录`
            process.stdout.write(`   ${offset(human(e.bytes))}  ${detail}\n            ${p}\n`)
        }
    }
    if (probe?.ok) {
        const rsum = remoteTotals(probe.rows)
        process.stdout.write(`\n云上合计:${rsum.present}/${rsum.sources} 个来源存在,${rsum.files} 个文件,${human(rsum.bytes)}${rsum.missing ? `,${rsum.missing} 个缺失` : ''}\n`)
    }
}

process.stdout.write(
    `\n本机合计:${sum.present}/${sum.sources} 个来源存在,${sum.files} 个文件,${human(sum.bytes)}` +
    `${sum.missing ? `,${sum.missing} 个缺失` : ''}\n`
)

if (manifest.prepare?.length) {
    process.stdout.write('prepare 步骤:' + manifest.prepare.map((s) => `${s.id}(${s.kind} -> ${s.target})`).join(', ') + '—— --apply 会先跑它\n')
}

if (wantPull && remote) {
    process.stdout.write('\n云上拉取(rsync,只打印命令):\n')
    for (const c of pullCommands(remote, stageDir)) {
        process.stdout.write(`  [${c.id}] ${c.cmd} ${c.args.join(' ')}\n`)
    }
}

if (has('--prepare') && !wantApply) {
    const results = runPrepare(manifest, { dryRun: false })
    for (const r of results) {
        process.stdout.write(r.ok ? `[prepare 完成] ${r.id} -> ${r.target}${r.bytes ? ` (${human(r.bytes)})` : ''}\n` : `[prepare 失败] ${r.id}:${r.error}\n`)
    }
    process.exit(results.some((r) => !r.ok) ? 1 : 0)
}

if (!wantApply) {
    process.stdout.write('这是 --dry-run:没有读取任何远端(除非给了 --remote),也没有写入任何备份。\n')
    process.exit(strict && sum.missing > 0 ? 1 : 0)
}

// ---- --apply:先校验配置(拒绝执行时不留下任何副作用),再 prepare -> 可选 rsync 拉取 -> restic ----
const repository = process.env.RESTIC_REPOSITORY || manifest.restic.repository
const passwordFile = process.env.RESTIC_PASSWORD_FILE || manifest.restic.passwordFile
const paths = rows.flatMap((row) => row.entries.filter((e) => e.exists).map((e) => e.path))
if (wantPull && remote) paths.push(stageDir)
const excludes = manifest.excludeDirs.flatMap((name) => ['--exclude', `**/${name}`])

if (!repository || !passwordFile) {
    process.stderr.write(
        '[失败] --apply 需要备份目标与密码文件,二者都没配置(这一步故意在任何写盘之前拦下):\n' +
        '  repository:config/backup.json 的 restic.repository 或 $RESTIC_REPOSITORY\n' +
        '  passwordFile:config/backup.json 的 restic.passwordFile 或 $RESTIC_PASSWORD_FILE\n' +
        '目标位置还没定(见 docs/infrastructure.md 的待决策项),所以这一步故意拒绝执行。\n' +
        '--dry-run 不受影响,现在就能用。\n'
    )
    process.exit(2)
}

const probeRestic = spawnSync('restic', ['version'], { encoding: 'utf8' })
if (probeRestic.error) {
    process.stderr.write('[失败] 找不到 restic;先装(scoop install restic)再跑 --apply\n')
    process.exit(2)
}

if (manifest.prepare?.length && !has('--no-prepare')) {
    for (const r of runPrepare(manifest, { dryRun: false })) {
        process.stdout.write(r.ok ? `[prepare 完成] ${r.id} -> ${r.target}${r.bytes ? ` (${human(r.bytes)})` : ''}\n` : `[prepare 失败] ${r.id}:${r.error}\n`)
        if (!r.ok) process.exit(2)
    }
}

if (wantPull && remote) {
    if (remote.unresolvedHost) { process.stderr.write('[失败] --pull 需要 BACKUP_REMOTE_SSH;先填 ~/.config/automation-suite/local-paths.env\n'); process.exit(2) }
    for (const c of pullCommands(remote, stageDir)) {
        process.stdout.write(`rsync ${c.args.join(' ')}\n`)
        const r = spawnSync(c.cmd, c.args, { stdio: 'inherit' })
        if (r.status !== 0) { process.stderr.write(`[失败] rsync 拉取 ${c.id} 退出码 ${r.status}\n`); process.exit(2) }
    }
}

const resticArgs = ['-r', repository, '--password-file', passwordFile, 'backup', ...paths, '--tag', manifest.restic.tag ?? 'backup', ...excludes]
const extra = args.filter((a) => a.startsWith('--restic-')).map((a) => `--${a.slice('--restic-'.length)}`)
process.stdout.write(`restic ${resticArgs.join(' ')} ${extra.join(' ')}\n`)
const run = spawnSync('restic', [...resticArgs, ...extra], { stdio: 'inherit' })
process.exit(run.status ?? 1)