// Windows 计划任务触发器的生成物(task XML)与动作路径解析 —— apply-schedule.mjs 的纯函数部分。
// Linux 侧的单套件 systemd unit 在 scripts/lib/schedule-linux.mjs。
//
// 只把归一化后的 program 对象变成字符串,不读写任何本机文件,便于干跑与测试。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isoDuration } from './schedule.mjs'

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 触发器的重复段;windowMinutes 为 0 表示不重复。 */
export function repetition(minutes, windowMinutes) {
    if (!windowMinutes) return ''
    return `<Repetition><Interval>${isoDuration(minutes)}</Interval><Duration>${isoDuration(windowMinutes)}</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>`
}

/** 读机器私有的 local-paths.env(KEY=VALUE,与 sync-*.sh 同一份),用于展开 %XXX_DIR% 占位符。 */
export function loadPrivatePaths(file = process.env.AUTOMATION_LOCAL_PATHS || path.join(os.homedir(), '.config', 'automation-suite', 'local-paths.env')) {
    const out = { file, values: {} }
    if (!fs.existsSync(file)) return out
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
        if (m) out.values[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
}

/** 把 actionVbs 里的 %XXX_DIR% 展开成本机路径;填不了就给出原因(--apply 前会拦)。 */
export function resolveAction(p, privatePaths) {
    const raw = p.actionVbs
    if (!raw || raw.includes('<')) return { ok: false, reason: 'actionVbs 没填 —— 填 run-daily.vbs 的绝对路径,或用 %REWARDS_DIR% / %WEREAD_SIGNIN_DIR% 占位符' }
    const missing = [...raw.matchAll(/%([A-Z_][A-Z0-9_]*)%/g)].map((m) => m[1]).filter((k) => !(process.env[k] || privatePaths.values[k]))
    if (missing.length) {
        return { ok: false, reason: `占位符 ${missing.map((k) => `%${k}%`).join(', ')} 没有值 —— 填 ${privatePaths.file}` }
    }
    return { ok: true, value: raw.replace(/%([A-Z_][A-Z0-9_]*)%/g, (_, k) => process.env[k] || privatePaths.values[k]) }
}

/** Windows 计划任务 XML(与 weread install-autostart.ps1 同一形态;登录延迟必须是 PT#M)。 */
export function windowsXml(p, { user, action }) {
    const d = new Date(Date.now() + 86400000)
    const boundary = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${p.startTime}:00`
    const desc = `自动化套件:${p.id}。触发只给一次机会,程序自己判断该不该真跑(见 docs/scheduling-convention.md)`
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>${esc(desc)}</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${esc(user)}</UserId>
      <Delay>${isoDuration(p.logonDelayMinutes)}</Delay>
      ${repetition(p.logonRetryMinutes, p.logonRetryWindowMinutes)}
    </LogonTrigger>
    <CalendarTrigger>
      <StartBoundary>${boundary}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
      ${repetition(p.intervalMinutes, p.windowMinutes)}
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${esc(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT3H</ExecutionTimeLimit>
    <Enabled>${p.enabled}</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>"${esc(action)}"</Arguments>
    </Exec>
  </Actions>
</Task>
`
}

export const windowsRegisterPs1 = (p) =>
    `# 注册 ${p.taskName}:任务名与触发器都来自 config/schedule.json(生成物,别手改)\n` +
    `Register-ScheduledTask -TaskName '${p.taskName}' -Xml (Get-Content -Raw '${p.taskName}.xml') -Force | Out-Null\n`
