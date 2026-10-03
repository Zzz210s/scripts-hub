// 错峰:检查同伴程序是否在跑。
// 约定:每个程序把单实例锁写在 logs/run.lock,并把判定逻辑放在 scripts/windows/run-state.js。
// 这里以同伴自己的 lock-status 为准(它知道残锁与进程实况),只在查不通时才用锁的年龄兜底。
// 早期实现只看锁文件时间戳,既读不到 pid 又会把残锁当成"在跑",给出的理由也看不懂。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export function peerBusy(lockFiles, { exec = execFileSync, timeoutMs = 60000, now = Date.now() } = {}) {
    for (const file of lockFiles ?? []) {
        let stat
        try {
            stat = fs.statSync(file)
        } catch {
            continue
        }
        const projectDir = path.resolve(path.dirname(file), '..')
        const project = path.basename(projectDir)
        const ageMinutes = Math.max(0, Math.round((now - stat.mtimeMs) / 60000))

        let verdict = ''
        const checkScript = path.join(projectDir, 'scripts', 'windows', 'run-state.js')
        if (fs.existsSync(checkScript)) {
            try {
                verdict = exec('node', [checkScript, 'lock-status'], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true }).trim()
            } catch { /* 查不通时走兜底 */ }
        }
        if (verdict === 'RUNNING') {
            return { busy: true, project, ageMinutes, detail: `${project} 正在运行 · 已 ${ageMinutes} 分钟` }
        }
        if (verdict === 'STALE' || verdict === 'NONE') continue   // 残锁不挡
        if (ageMinutes < 10) return { busy: true, project, ageMinutes, detail: `${project} 可能刚启动 · 锁创建于 ${ageMinutes} 分钟前` }
    }
    return { busy: false }
}
