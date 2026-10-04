#!/usr/bin/env node
// 本机异地备份:把「没有远端副本」的东西列清楚,并(可选)交给 restic 推走。
//
//   node scripts/backup.mjs                      # 默认 --dry-run:只枚举,不装 restic 也能跑
//   node scripts/backup.mjs --list               # 只看清单里有哪些集合
//   node scripts/backup.mjs --json               # 机器可读
//   node scripts/backup.mjs --set=notes          # 只看一个集合
//   node scripts/backup.mjs --include-optional   # 连 optional 集合一起枚举
//   node scripts/backup.mjs --strict             # 有任何路径缺失就退出 1
//   node scripts/backup.mjs --apply              # 真备份,需要 restic + 仓库参数
//
// --apply 的仓库与密码来自 config/backup.json 的 restic 段,或环境变量
// RESTIC_REPOSITORY / RESTIC_PASSWORD_FILE。缺任一就拒绝执行(不猜、不落默认路径)。
// 选型与目标位置选项见 docs/infrastructure.md。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { human, inspect, loadManifest, totals, unresolved } from './lib/backup.mjs'

const REPO_DIR = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const value = (name) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)

const manifestFile = path.resolve(value('--config') ?? path.join(REPO_DIR, 'config', 'backup.json'))
const manifest = loadManifest(manifestFile)
const wantJson = has('--json')
const wantApply = has('--apply')
const includeOptional = has('--include-optional')
const only = value('--set') ?? null
const strict = has('--strict')

if (only && !manifest.sets.some((s) => s.id === only)) {
    process.stderr.write(`[失败] 清单里没有集合 ${only}(可用:${manifest.sets.map((s) => s.id).join(', ')})\n`)
    process.exit(2)
}

const rows = inspect(manifest, { includeOptional, only })
const sum = totals(rows)
const leftOver = unresolved(rows.flatMap((r) => r.paths ?? []))

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
    process.exit(0)
}

if (wantJson) {
    process.stdout.write(`${JSON.stringify({ manifest: manifestFile, totals: sum, sets: rows }, null, 2)}\n`)
    process.exit(strict && sum.missing > 0 ? 1 : 0)
}

process.stdout.write(`备份清单:${manifestFile}\n`)
for (const row of rows) {
    const shown = includeOptional || !row.optional
    const head = row.skipped ? `${row.id} —— 跳过(optional,加 --include-optional 才枚举)` : row.id
    process.stdout.write(`\n== ${head} [${row.priority}] ==\n   ${row.why}\n`)
    if (!shown) continue
    for (const entry of row.entries) {
        if (!entry.exists) {
            process.stdout.write(`   缺失  ${entry.path}\n`)
            continue
        }
        const detail = entry.kind === 'file' ? '1 个文件' : `${entry.files} 个文件 / ${entry.dirs} 个目录`
        const note = entry.deep === false ? ' (有目录读不动,权限)' : ''
        process.stdout.write(`   ${human(entry.bytes).padStart(7)}  ${detail}${note}\n            ${entry.path}\n`)
    }
}

process.stdout.write(
    `\n合计:${sum.present}/${sum.sources} 个来源存在,${sum.files} 个文件,${human(sum.bytes)}` +
    `${sum.missing ? `,${sum.missing} 个缺失` : ''}\n`
)

if (!wantApply) {
    process.stdout.write('这是 --dry-run:没有读取任何远端,也没有写入任何备份。\n')
    process.exit(strict && sum.missing > 0 ? 1 : 0)
}

// ---- --apply:交给 restic ----
const repository = process.env.RESTIC_REPOSITORY || manifest.restic.repository
const passwordFile = process.env.RESTIC_PASSWORD_FILE || manifest.restic.passwordFile
const paths = rows.flatMap((row) => row.entries.filter((e) => e.exists).map((e) => e.path))
const excludes = manifest.excludeDirs.flatMap((name) => ['--exclude', `**/${name}`])

if (!repository || !passwordFile) {
    process.stderr.write(
        '[失败] --apply 需要备份目标与密码文件,二者都没配置:\n' +
        '  repository:config/backup.json 的 restic.repository 或 $RESTIC_REPOSITORY\n' +
        '  passwordFile:config/backup.json 的 restic.passwordFile 或 $RESTIC_PASSWORD_FILE\n' +
        '目标位置还没定(见 docs/infrastructure.md 的待决策项),所以这一步故意拒绝执行。\n' +
        '--dry-run 不受影响,现在就能用。\n'
    )
    process.exit(2)
}

const probe = spawnSync('restic', ['version'], { encoding: 'utf8' })
if (probe.error) {
    process.stderr.write('[失败] 找不到 restic;先装(scoop install restic)再跑 --apply\n')
    process.exit(2)
}

const resticArgs = ['-r', repository, '--password-file', passwordFile, 'backup', ...paths, '--tag', manifest.restic.tag ?? 'backup', ...excludes]
const extra = args.filter((a) => a.startsWith('--restic-')).map((a) => `--${a.slice('--restic-'.length)}`)
process.stdout.write(`restic ${resticArgs.join(' ')} ${extra.join(' ')}\n`)
const run = spawnSync('restic', [...resticArgs, ...extra], { stdio: 'inherit' })
process.exit(run.status ?? 1)
