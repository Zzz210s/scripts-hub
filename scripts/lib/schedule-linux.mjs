// Linux/容器侧的触发模型:单套件 systemd unit(`automation-suite.timer` -> `automation-suite.service`),
// 每天 08:00 与 12:00 各触发一次、Persistent=true,套件脚本按 `order` 顺序跑完所有启用的程序。
//
// 权威实现在 scripts/linux/(systemd/automation-suite.{timer,service} + run-all.sh);本模块只把
// config/schedule.json 的 `linux` 段渲染成同形态的 unit 文本,便于 --dry-run 核对与换机重建。
// Windows 是每个程序一个计划任务,不走这里。
//
// 为什么 Linux 侧不是逐程序 timer:见 docs/scheduling-convention.md 第 1 节。
//
// 每个程序的 Linux 启用判定只有一处实现:scripts/linux/program-enabled.mjs(它要单独部署到
// 套件根目录,所以住在那里);这里转出给 schedule.mjs 的干跑清单用,两边永远同源。
import { linuxEnabledState } from '../linux/program-enabled.mjs'
export { linuxEnabledState }

export const LINUX_DEFAULTS = {
    unit: 'automation-suite',
    times: ['08:00', '12:00'],
    persistent: true,
    suiteDir: '/srv/apps/automation',
    user: 'ubuntu'
}

const HHMM = /^(\d{1,2}):(\d{2})$/
const isHHMM = (v) => {
    const m = HHMM.exec(String(v || ''))
    return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59
}

/** 校验并归一化配置里的 `linux` 段;问题写进 errors,返回带默认值的对象。
 *  programs 传进来只为顺带体检各程序的 enabled/linuxEnabled 是不是合法布尔 —— 取值非法按
 *  「读不到」报错,不悄悄取一个方向,这样干跑与 run-all.sh 的闸门行为一致。 */
export function normalizeLinux(raw, errors, programs) {
    const linux = { ...LINUX_DEFAULTS, ...(raw || {}) }
    const times = Array.isArray(linux.times) ? linux.times.map(String) : []
    if (!times.length || !times.every(isHHMM)) errors.push(`linux.times 必须是非空的 HH:MM 数组:${JSON.stringify(linux.times)}`)
    if (typeof linux.persistent !== 'boolean') errors.push(`linux.persistent 必须是布尔值:${linux.persistent}`)
    for (const key of ['unit', 'suiteDir', 'user']) {
        if (typeof linux[key] !== 'string' || !linux[key]) errors.push(`linux.${key} 必须是非空字符串:${linux[key]}`)
    }
    for (const [id, p] of Object.entries(programs || {})) {
        if (linuxEnabledState(p) === null) errors.push(`${id} 的 Linux 启用取值必须是布尔,实际 linuxEnabled=${JSON.stringify(p.linuxEnabled)} enabled=${JSON.stringify(p.enabled)}`)
    }
    return { ...linux, times }
}

/** 单套件 timer:多个 OnCalendar + Persistent;Unit 指向套件 service。 */
export function suiteTimer(linux) {
    const onCalendar = linux.times.map((t) => `OnCalendar=*-*-* ${t}:00`).join('\n')
    return `# 由 scripts/apply-schedule.mjs 从 config/schedule.json 的 linux 段生成;权威实现在 scripts/linux/
[Unit]
Description=自动化套件(按顺序跑完所有启用的程序)

[Timer]
${onCalendar}
Persistent=${linux.persistent}
AccuracySec=1min
Unit=${linux.unit}.service

[Install]
WantedBy=timers.target
`
}

/** 单套件 service:oneshot,ExecStart 指向编排脚本 run-all.sh(顺序由它保证)。 */
export function suiteService(linux) {
    return `[Unit]
Description=自动化套件(顺序编排,跑完退出)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
User=${linux.user}
WorkingDirectory=${linux.suiteDir}
EnvironmentFile=-${linux.suiteDir}/suite.env
ExecStart=${linux.suiteDir}/run-all.sh
TimeoutStartSec=infinity
Nice=5
`
}

/** 顺序说明(给人核对 run-all.sh 的先后);programs 是归一化后的数组。 */
export function suiteOrderText(programs) {
    return programs.map((p, i) => `${i + 1}. ${p.id}`).join('\n') + '\n'
}
