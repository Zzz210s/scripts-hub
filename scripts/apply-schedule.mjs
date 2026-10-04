#!/usr/bin/env node
// 按 config/schedule.json 生成触发器:Windows = 每程序一个计划任务;Linux/容器 = 单套件
// automation-suite.timer。默认只打印(--dry-run),--apply --yes 才真注册 Windows 任务。
//
//   node scripts/apply-schedule.mjs [--dry-run|--apply --yes] [--dest=<目录>]
//        [--emit=windows|systemd|both] [--only=<程序id>] [--suite-dir=/srv/apps/automation]
//
// 不写 config/ 之外的仓库文件;生成的 XML/unit 只落在 --dest 或临时目录。Windows 只注册配置里
// enabled 的程序,不动别的计划任务。规则见 docs/scheduling-convention.md;Linux 权威实现在
// scripts/linux/。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadSchedule, describe } from './lib/schedule.mjs'
import { loadPrivatePaths, resolveAction, windowsXml, windowsRegisterPs1 } from './lib/schedule-targets.mjs'
import { suiteTimer, suiteService, suiteOrderText } from './lib/schedule-linux.mjs'

const HELP = `用法:node scripts/apply-schedule.mjs [选项]
  --dry-run       默认;只打印生成的触发器,不碰本机任务
  --apply --yes   真注册(Windows),改的是本机计划任务
  --dest=<目录>   把生成物写出来(windows/*.xml、systemd/automation-suite.{timer,service})
  --emit=windows|systemd|both   只生成哪一侧(默认 both;--apply 时是 windows)
  --only=<程序id> 只处理一个程序
  --suite-dir=<目录>  Linux 套件根目录,默认取 config/schedule.json 的 linux.suiteDir`

const args = process.argv.slice(2)
const has = (name) => args.some((a) => a === name || a.startsWith(`${name}=`))
const opt = (name, fallback) => {
    const hit = args.find((a) => a.startsWith(`${name}=`))
    return hit ? hit.slice(name.length + 1) : fallback
}
if (has('--help') || has('-h')) {
    console.log(HELP)
    process.exit(0)
}
const apply = has('--apply')
const dest = opt('--dest', '')
const emit = opt('--emit', apply ? 'windows' : 'both')
const only = opt('--only', '')
const suiteDirOpt = opt('--suite-dir', '')
if (!['windows', 'systemd', 'both'].includes(emit)) {
    console.error(`[错误] --emit 只能是 windows|systemd|both:${emit}`)
    process.exit(2)
}
if (apply && !has('--yes')) {
    console.error('[错误] --apply 会真的改动本机计划任务;确认后加 --yes(不确认就只跑 --dry-run)')
    process.exit(2)
}

const { schedule, source, warnings } = loadSchedule()
for (const w of warnings) console.error(`[警告] ${w}`)
console.error(`[配置] ${source}  时区 ${schedule.timezone}`)
for (const n of schedule.notes) console.error(`[注意] ${n}`)

const privatePaths = loadPrivatePaths()
const linux = { ...schedule.linux, suiteDir: suiteDirOpt || schedule.linux.suiteDir }
const programs = schedule.order.map((id) => schedule.programs[id]).filter((p) => (only ? p.id === only : true))
if (only && !programs.length) {
    console.error(`[错误] 没有这个程序:${only}(有:${schedule.order.join(', ')})`)
    process.exit(2)
}

const userId = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME || '%USERNAME%'
const files = new Map()
const actions = {}
const enabled = programs.filter((p) => p.enabled)
console.log(`== 调度(${schedule.order.join(' -> ')})==`)

if (emit !== 'systemd') {
    console.log('-- Windows:每个启用的程序一个计划任务(登录触发 + 每日窗口;时间来自 schedule.json 的 programs)--')
    for (const p of programs) {
        console.log(`${p.enabled ? '[注册]' : '[跳过]'} ${p.id.padEnd(20)} ${p.taskName.padEnd(24)} ${describe(p)}`)
        if (!p.enabled) continue
        const action = resolveAction(p, privatePaths)
        actions[p.id] = action
        if (!action.ok) console.error(`[注意] ${p.id}:${action.reason}`)
        files.set(`windows/${p.taskName}.xml`, windowsXml(p, { user: userId, action: action.ok ? action.value : p.actionVbs || '<未填>' }))
        files.set(`windows/register-${p.taskName}.ps1`, windowsRegisterPs1(p))
    }
}

if (emit !== 'windows') {
    console.log(`-- Linux/容器:单套件 ${linux.unit}.timer 于 ${linux.times.join(' 与 ')} 触发(Persistent=${linux.persistent}),按 order 顺序跑 --`)
    enabled.forEach((p, i) => console.log(`   ${i + 1}. ${p.id}`))
    files.set(`systemd/${linux.unit}.timer`, suiteTimer(linux))
    files.set(`systemd/${linux.unit}.service`, suiteService(linux))
    files.set('systemd/order.txt', suiteOrderText(enabled))
}

for (const [rel, body] of files) {
    if (dest) {
        const abs = path.join(dest, rel)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, body)
    }
    if (!apply) console.log(`\n--- ${dest ? path.join(dest, rel) : rel} ---\n${body}`)
}
if (dest) console.error(`[写出] ${files.size} 个文件 -> ${dest}`)

if (!apply) {
    console.log('== 干跑结束:没有改动任何本机任务。生效:node scripts/apply-schedule.mjs --apply --yes ==')
    process.exit(0)
}
if (emit === 'systemd') {
    console.error('[错误] --apply 只注册 Windows 任务;Linux 用 --emit=systemd --dest=<目录> 生成 unit 后自行安装(权威实现在 scripts/linux/)')
    process.exit(2)
}
if (process.platform !== 'win32') {
    console.error('[错误] --apply 只实现了 Windows;Linux 用 --emit=systemd --dest=<目录> 生成 unit 后自行 systemctl --user enable')
    process.exit(2)
}
const blocked = programs.filter((p) => p.enabled && !actions[p.id]?.ok)
if (blocked.length) {
    for (const p of blocked) console.error(`[错误] ${p.id}:${actions[p.id].reason}`)
    process.exit(2)
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-schedule-'))
for (const [rel, body] of files) {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true })
    fs.writeFileSync(path.join(tmp, rel), body)
}
let failed = 0
for (const p of programs.filter((x) => x.enabled)) {
    const xml = path.join(tmp, 'windows', `${p.taskName}.xml`).replace(/'/g, "''")
    const cmd = `Register-ScheduledTask -TaskName '${p.taskName}' -Xml (Get-Content -Raw '${xml}') -Force | Out-Null; Write-Host '[OK] ${p.taskName}'`
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { stdio: 'inherit' })
    if (r.status !== 0) {
        console.error(`[错误] 注册 ${p.taskName} 失败(exit ${r.status})`)
        failed += 1
    }
}
fs.rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `== 注册结束:${failed} 个失败 ==` : '== 注册结束:全部成功 ==')
process.exit(failed ? 1 : 0)
