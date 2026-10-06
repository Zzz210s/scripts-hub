// 恢复演练:拿一份快照,真取历史、真解包、真拼成一个工作区,再把结果与源/清单逐项对照。
//
// 判据(与 scripts/note-snapshot.mjs --drill 一致):
//   ① repo.bundle 里的 refs 与清单一致;全量取回后 git fsck --full 干净、提交数与清单一致
//   ② worktree.tar.zst 解出的文件数/总字节/摘要与清单一致;给了 --source 就逐文件比 sha256
//   ③ 历史 + 工作区合起来是一个可用工作区:以 HEAD 为基准重新算一遍每个文件的差异(D/M/多出),
//      与在恢复出来的工作区里跑 git status 的结果一一对上(索引不参与,所以与快照时是否暂存过无关)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { ARCHIVE_NAME, BUNDLE_NAME, MANIFEST_NAME, slash } from './note-store.mjs'
import { sha256File } from './note-git.mjs'
import { walkHashes } from './note-snapshot.mjs'

const run = (cmd, args, cwd, input) => spawnSync(cmd, args, { cwd, input, encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true })
const out2 = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()

/** 解析 git show-ref 输出为 { ref: sha }。 */
export function parseRefs(text) {
    const refs = {}
    for (const l of String(text).trim().split('\n').filter(Boolean)) {
        const [sha, ref] = l.split(' ')
        refs[ref] = sha
    }
    return refs
}

/** 解析 git ls-tree -r HEAD 输出为 { path: blobSha }。 */
export function parseLsTree(text) {
    const tree = {}
    for (const l of String(text).trim().split('\n').filter(Boolean)) {
        const [meta, p] = l.split('\t')
        tree[p] = meta.split(/\s+/)[2]
    }
    return tree
}

/** 逐路径对比两份 walkHashes 结果,返回差异(最多列 limit 条)。 */
export function diffTrees(expected, actual, limit = 10) {
    const diffs = []
    for (const [p, e] of Object.entries(expected.byPath)) {
        const a = actual.byPath[p]
        if (!a) diffs.push(`缺:${p}`)
        else if (a.sha256 !== e.sha256) diffs.push(`内容不一致:${p}`)
    }
    for (const p of Object.keys(actual.byPath)) if (!expected.byPath[p]) diffs.push(`多出:${p}`)
    return { total: diffs.length, shown: diffs.slice(0, limit) }
}

/** 以 HEAD 为基准独立算一遍:哪些路径该是 D(HEAD 有、工作区没)、M(都在但内容不同)、多出(工作区有、HEAD 没且没被 .gitignore 忽略)。 */
export function classifyAgainstHead(tree, blobByPath, ignored) {
    const expect = { D: [], M: [], '??': [] }
    for (const [p, sha] of Object.entries(tree)) {
        if (!(p in blobByPath)) expect.D.push(p)
        else if (blobByPath[p] !== sha) expect.M.push(p)
    }
    for (const p of Object.keys(blobByPath)) {
        if (!(p in tree) && !ignored.has(p)) expect['??'].push(p)
    }
    for (const k of Object.keys(expect)) expect[k].sort()
    return expect
}

export function drillSnapshot({ dir, source = null, keepTmp = false, limit = 10 }) {
    const checks = []
    const log = []
    const add = (name, ok, detail) => { checks.push({ name, ok, detail }); return ok }
    const dir0 = path.resolve(dir)
    let manifest = null
    try {
        manifest = JSON.parse(fs.readFileSync(path.join(dir0, MANIFEST_NAME), 'utf8'))
        add('manifest 可读', true, `date=${manifest.date} head=${String(manifest.git?.head).slice(0, 12)}`)
    } catch (e) {
        add('manifest 可读', false, String(e.message ?? e))
        return { ok: false, checks, log }
    }
    for (const a of manifest.artifacts ?? []) {
        const f = path.join(dir0, a.name)
        const sha = fs.existsSync(f) ? sha256File(f) : null
        add(`制品 ${a.name} 完好`, sha === a.sha256, sha ? `sha256=${sha.slice(0, 16)}... ${sha === a.sha256 ? '与清单一致' : '与清单不一致'}` : '文件缺失')
    }

    const bundle = slash(path.join(dir0, BUNDLE_NAME))
    const archive = slash(path.join(dir0, ARCHIVE_NAME))
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'note-drill-'))
    try {
        const full = path.join(tmp, 'full')
        fs.mkdirSync(full)
        run('git', ['init', '--quiet', '.'], full)
        const verify = run('git', ['bundle', 'verify', bundle], full)
        log.push(...out2(verify).split('\n').filter(Boolean).map((l) => `[verify] ${l}`))
        add('bundle verify', verify.status === 0, out2(verify).split('\n').at(-1) ?? '')

        const heads = parseRefs(run('git', ['bundle', 'list-heads', bundle], full).stdout)
        const wantRefs = manifest.git.refs ?? {}
        const names = Object.keys(heads).filter((r) => r !== 'HEAD')
        const refDiff = Object.entries(wantRefs).filter(([r, sha]) => heads[r] !== sha)
        add('bundle 内的 refs 与清单一致', refDiff.length === 0 && names.length === Object.keys(wantRefs).length,
            `bundle 里 ${names.length} 个 ref${refDiff.length ? `,不一致:${refDiff.map(([r]) => r).join(', ')}` : ',全部一致'}`)

        const fetch = run('git', ['fetch', '--quiet', bundle, '+refs/*:refs/bundle/*'], full)
        if (!add('全量取回 bundle 的 refs', fetch.status === 0, out2(fetch) || 'ok')) throw new Error('取回失败,后续检查跳过')
        const fsckOut = out2(run('git', ['fsck', '--full'], full))
        log.push(`[fsck] ${fsckOut || '(无输出 = 干净)'}`)
        add('git fsck --full 干净', !/error|missing|corrupt|dangling/i.test(fsckOut), fsckOut || '无输出(干净)')
        const commits = Number(run('git', ['rev-list', '--count', '--all'], full).stdout.trim())
        add('提交数与清单一致', commits === manifest.git.commits, `取回后 ${commits} 个,清单 ${manifest.git.commits} 个`)
        const gotRefs = Object.fromEntries(Object.entries(parseRefs(run('git', ['show-ref'], full).stdout)).map(([r, s]) => [r.replace('refs/bundle/', 'refs/'), s]))
        const d2 = Object.entries(wantRefs).filter(([r, sha]) => gotRefs[r] !== sha)
        add('取回后的 refs 指向与清单一致', d2.length === 0, d2.length ? `不一致:${d2.map(([r]) => r).join(', ')}` : `${Object.keys(gotRefs).length} 个 ref 全部一致`)
        log.push(`[git] HEAD=${String(manifest.git.head).slice(0, 12)} commits=${commits} refs=${Object.keys(gotRefs).length}`)

        const out = path.join(tmp, 'worktree')
        fs.mkdirSync(out)
        const tarFile = slash(path.join(tmp, 'w.tar'))
        fs.writeFileSync(tarFile, zlib.zstdDecompressSync(fs.readFileSync(archive)))
        const untar = run('tar', ['--force-local', '-xf', tarFile, '-C', slash(out)], tmp)
        add('工作区解包成功', untar.status === 0, out2(untar) || `解到 ${out}`)
        const got = untar.status === 0 ? walkHashes(out) : { files: 0, bytes: 0, digest: '', byPath: {} }
        const want = manifest.worktree
        add('工作区文件数/字节/摘要与清单一致', got.files === want.files && got.bytes === want.bytes && got.digest === want.digest,
            `解出 ${got.files} 个文件 / ${got.bytes} 字节 / ${String(got.digest).slice(0, 12)},清单 ${want.files} 个 / ${want.bytes} 字节 / ${String(want.digest).slice(0, 12)}`)
        if (source) {
            const src = walkHashes(source)
            const d = diffTrees(src, got, limit)
            add(`逐文件 sha256 比对源 ${source}`, d.total === 0, d.total ? `${d.total} 处差异:${d.shown.join(' | ')}` : `${src.files} 个文件全部一致`)
        }

        const clone = path.join(tmp, 'clone')
        const cl = run('git', ['clone', '--quiet', '--no-checkout', bundle, slash(clone)], tmp)
        if (!add('bundle 可克隆(--no-checkout)', cl.status === 0, out2(cl) || clone)) throw new Error('克隆失败,工作区合成检查跳过')
        const overlay = run('tar', ['--force-local', '-xf', tarFile, '-C', slash(clone)], tmp)
        run('git', ['reset', '--quiet'], clone)
        const head = run('git', ['rev-parse', 'HEAD'], clone).stdout.trim()
        add('clone 后 HEAD 与清单一致', head === manifest.git.head, `clone=${head.slice(0, 12)} 清单=${String(manifest.git.head).slice(0, 12)}`)

        const paths = Object.keys(got.byPath)
        const blobText = run('git', ['hash-object', '--stdin-paths'], out, paths.join('\n')).stdout.trim().split('\n')
        const blobByPath = Object.fromEntries(paths.map((p, i) => [p, blobText[i]]))
        const ignoredText = run('git', ['-c', 'core.quotepath=false', 'check-ignore', '--stdin'], clone, paths.join('\n')).stdout.trim()
        const ignored = new Set(ignoredText.split('\n').filter(Boolean))
        const expect = classifyAgainstHead(parseLsTree(run('git', ['-c', 'core.quotepath=false', 'ls-tree', '-r', 'HEAD'], clone).stdout), blobByPath, ignored)
        const observed = { D: [], M: [], '??': [] }
        for (const line of run('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '-uall'], clone).stdout.split('\n').filter(Boolean)) {
            const code = line.slice(0, 2).trim() === '??' ? '??' : line.slice(0, 2).trim()
            if (observed[code]) observed[code].push(line.slice(3).replace(/^"|"$/g, ''))
        }
        for (const k of Object.keys(observed)) observed[k].sort()
        const diffKeys = Object.keys(expect).filter((k) => JSON.stringify(expect[k]) !== JSON.stringify(observed[k]))
        add('clone + 工作区 = 可用工作区', overlay.status === 0, `解包 ${overlay.status === 0 ? '成功' : '失败'};工作区 ${got.files} 个文件`)
        add('差异分类与 git status 一一对上', diffKeys.length === 0,
            diffKeys.length
                ? `${diffKeys.join('/')} 对不上:独立算出 ${diffKeys.map((k) => `${k}=${expect[k].length}`).join(' ')},git status 给 ${diffKeys.map((k) => `${k}=${observed[k].length}`).join(' ')};例子 ${diffKeys.map((k) => `${k}:${(expect[k].find((p) => !observed[k].includes(p)) ?? observed[k][0] ?? '')}`).join(' | ')}`
                : `D=${expect.D.length} M=${expect.M.length} 多出=${expect['??'].length},逐条一致`)
        log.push(...expect.D.slice(0, limit).map((p) => `[D] ${p}`))
        log.push(...expect.M.slice(0, limit).map((p) => `[M] ${p}`))
        log.push(...expect['??'].slice(0, limit).map((p) => `[??] ${p}`))
        log.push(`[tmp] ${tmp}`)
        return { ok: checks.every((c) => c.ok), checks, log, tmp: keepTmp ? tmp : null }
    } finally {
        if (!keepTmp) fs.rmSync(tmp, { recursive: true, force: true })
    }
}
