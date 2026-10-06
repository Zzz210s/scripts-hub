// prepare 步骤:SQLite 活库的一致性快照(VACUUM INTO)与笔记库快照(bundle + 工作区归档)。
// 见 config/backup.json 的 prepare 段。
//
// 只在 --apply(或 --prepare)时真正执行;默认 dry-run 只报告计划。
// VACUUM INTO 会写一份紧凑、WAL 已合并的副本到 target;target 必须不存在(存在则先删)。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { buildSnapshot } from './note-snapshot.mjs'

const require = createRequire(import.meta.url)

const expand = (p) => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p)

/** 执行清单里的 prepare 步骤。返回每步结果,不抛。 */
export function runPrepare(manifest, { dryRun = true } = {}) {
    const results = []
    for (const step of manifest.prepare ?? []) {
        const source = expand(step.source)
        const target = expand(step.target)
        if (step.kind === 'note-snapshot') {
            results.push(runNoteSnapshot(step, { source, target, dryRun }))
            continue
        }
        if (step.kind !== 'sqlite-vacuum') {
            results.push({ id: step.id, ok: false, error: `未知的 prepare kind:${step.kind}` })
            continue
        }
        if (!fs.existsSync(source)) {
            results.push({ id: step.id, ok: false, error: `源库不存在:${source}` })
            continue
        }
        if (dryRun) {
            results.push({ id: step.id, ok: true, dryRun: true, source, target })
            continue
        }
        try {
            fs.mkdirSync(path.dirname(target), { recursive: true })
            if (fs.existsSync(target)) fs.rmSync(target)
            // 动态载入:node:sqlite 是实验特性,缺它时只让这一步失败,不拖垮整个脚本
            const { DatabaseSync } = require('node:sqlite')
            const db = new DatabaseSync(source)
            db.exec(`VACUUM INTO '${target.replace(/\\/g, '/').replace(/'/g, "''")}'`)
            db.close()
            results.push({ id: step.id, ok: true, source, target, bytes: fs.statSync(target).size })
        } catch (error) {
            results.push({ id: step.id, ok: false, error: String(error.message ?? error), source, target })
        }
    }
    return results
}

/** 笔记库快照步骤:产物落在 target(快照根目录)下,由 restic 的 notes-snapshot 集合收走。 */
function runNoteSnapshot(step, { source, target, dryRun }) {
    if (!fs.existsSync(source)) return { id: step.id, ok: false, error: `源仓库不存在:${source}` }
    try {
        const r = buildSnapshot({ repo: source, root: target, keep: step.keep ?? 3, dryRun, date: step.date ?? null })
        if (dryRun) return { id: step.id, ok: true, dryRun: true, source, target, date: r.plan.date }
        return { id: step.id, ok: true, source, target, dir: r.dir, bytes: r.manifest.artifacts.reduce((a, x) => a + x.bytes, 0), pruned: r.pruned }
    } catch (error) {
        return { id: step.id, ok: false, error: String(error.message ?? error), source, target }
    }
}