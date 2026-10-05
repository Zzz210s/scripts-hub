// 云主机(remote source)备份清单的展开与「从本机通过 SSH 拉取」的只读支持。
//
// 设计:默认 dry-run 只列出计划;--remote 才发一次只读 SSH(du/find/stat,不写任何东西);
// --pull 打印 rsync 命令,--pull --apply 才真的把云上目录拉到本机暂存再交给 restic。
// 路径与主机地址都从清单展开,仓库里不出现真实 IP。
import { spawnSync } from 'node:child_process'
import { expandPath } from './backup.mjs'

const isAbs = (p) => p.startsWith('/')

/** 展开 remote 段落:ssh 主机、root、每个 set 的绝对路径(相对 root 的拼 root)。 */
export function expandRemote(manifest) {
    const raw = manifest.remote
    if (!raw) return null
    const values = manifest._values ?? {}
    const ssh = expandPath(String(raw.ssh ?? ''), values)
    const unresolvedHost = /%[A-Z_][A-Z0-9_]*%/.test(ssh)
    const root = String(raw.root ?? '').replace(/\/+$/, '')
    const toAbs = (p) => {
        const e = expandPath(String(p), values).replace(/\\/g, '/')
        return isAbs(e) ? e : `${root}/${e}`
    }
    const sets = (raw.sets ?? []).map((set) => ({
        ...set,
        absolutePaths: (set.paths ?? []).map(toAbs),
        absoluteExcludes: (set.excludePaths ?? []).map(toAbs)
    }))
    return { ...raw, ssh, unresolvedHost, root, sets }
}

/** 远程枚举脚本里要跳过的目录名(只按 basename 匹配,含 / 的条目忽略)。 */
export function remoteExcludeNames(remote) {
    return [...new Set([...(remote.excludeDirs ?? [])].filter((n) => n && !n.includes('/')))]
}

/** 把可执行体拆出的字符串行解析成条目;纯函数,便于干跑与测试。 */
export function parseRemoteOutput(text, expectedPaths) {
    const map = new Map()
    for (const line of String(text).split(/\r?\n/)) {
        if (!line.trim()) continue
        const [kind, path, bytes, files, dirs] = line.split('\t')
        if (!path) continue
        map.set(path, {
            path,
            exists: kind !== 'missing',
            kind,
            bytes: Number(bytes) || 0,
            files: Number(files) || 0,
            dirs: Number(dirs) || 0
        })
    }
    return expectedPaths.map((p) => map.get(p) ?? { path: p, exists: false, kind: 'missing', bytes: 0, files: 0, dirs: 0 })
}

const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

/** 生成远程只读枚举脚本(du/find/stat 只读;绝不传输文件)。 */
export function remoteScript(remote) {
    const excludes = remoteExcludeNames(remote).map((n) => `--exclude=${sq(n)}`).join(' ')
    const paths = remote.sets.flatMap((s) => s.absolutePaths)
    return [
        'set -u',
        'emit() { p="$1";',
        `  if [ -d "$p" ]; then b=$(du -sb ${excludes} "$p" 2>/dev/null | cut -f1); f=$(find "$p" -type f 2>/dev/null | wc -l); d=$(find "$p" -type d 2>/dev/null | wc -l); printf 'dir\\t%s\\t%s\\t%s\\t%s\\n' "$p" "$b" "$f" "$d";`,
        '  elif [ -f "$p" ]; then b=$(stat -c %s "$p" 2>/dev/null || echo 0); printf \'file\\t%s\\t%s\\t1\\t0\\n\' "$p" "$b";',
        "  else printf 'missing\\t%s\\t0\\t0\\t0\\n' \"$p\"; fi; }",
        ...paths.map((p) => `emit ${sq(p)}`)
    ].join('\n')
}

/**
 * 只读枚举云上目录。exec 可注入(测试/干跑用);默认 spawnSync ssh。
 * 返回 { ok, ssh, rows, error? }。连不上或主机地址没展开时 ok=false,不抛。
 */
export function enumerateRemote(remote, { exec, timeout = 60000 } = {}) {
    if (remote.unresolvedHost) return { ok: false, ssh: remote.ssh, rows: [], error: '远程主机占位符没有值(填 ~/.config/automation-suite/local-paths.env 的 BACKUP_REMOTE_SSH)' }
    const script = remoteScript(remote)
    const run = exec ?? (() => spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', remote.ssh, 'bash -s'], { encoding: 'utf8', timeout, input: script }))
    const res = run(script)
    if (res.status !== 0) return { ok: false, ssh: remote.ssh, rows: [], error: (res.stderr || res.error?.message || 'ssh 失败').trim().split('\n')[0] }
    const rows = remote.sets.map((set) => {
        const entries = parseRemoteOutput(res.stdout ?? '', set.absolutePaths)
        return { ...set, entries }
    })
    return { ok: true, ssh: remote.ssh, rows }
}

/** 生成「从本机 SSH 拉取」的 rsync 命令(只打印;--apply 才执行)。 */
export function pullCommands(remote, stageDir) {
    const excludes = remoteExcludeNames(remote).map((n) => `--exclude=${n}`)
    const cmds = []
    for (const set of remote.sets) {
        const dest = `${stageDir.replace(/\/+$/, '')}/`
        cmds.push({
            id: set.id,
            cmd: 'rsync',
            args: ['-a', '--relative', '--no-owner', '--no-group', ...excludes, ...set.absolutePaths.map((p) => `${remote.ssh}:${p}`), dest]
        })
    }
    return cmds
}

/** 汇总 remote rows(与 lib/backup.mjs 的 totals 同形)。 */
export function remoteTotals(rows) {
    const sources = rows.flatMap((r) => r.entries ?? [])
    return {
        sources: sources.length,
        present: sources.filter((e) => e.exists).length,
        missing: sources.filter((e) => !e.exists).length,
        files: sources.reduce((a, e) => a + (e.exists ? e.files : 0), 0),
        bytes: sources.reduce((a, e) => a + (e.exists ? e.bytes : 0), 0)
    }
}