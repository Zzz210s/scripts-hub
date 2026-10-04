// 调度配置:读 config/schedule.json(缺则回退 config/schedule.example.json),校验并归一化。
//
// 纯库 + 一个只读小 CLI(诊断走 stderr,stdout 只放结果):
//   node scripts/lib/schedule.mjs show | expect <id> | json
// 生成/注册触发器见 scripts/apply-schedule.mjs;规则见 docs/scheduling-convention.md。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { normalizeLinux } from './schedule-linux.mjs'

export const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const HARD_DEFAULTS = {
    version: 1,
    timezone: 'Asia/Shanghai',
    order: ['microsoft-rewards', 'weread-signin'],
    stagger: { baseStartTime: '08:00', slotMinutes: 30, logonBaseMinutes: 3, logonStepMinutes: 7 },
    programs: {
        'microsoft-rewards': { taskName: 'MicrosoftRewardsScript', intervalMinutes: 120, windowHours: 14 },
        'weread-signin': { taskName: 'WeReadSignIn', intervalMinutes: 60, windowHours: 14 }
    }
}

export class ScheduleError extends Error {}

// 程序条目的默认值:让新增程序只写 taskName 与想让它们不同的字段就能跑。
const PROGRAM_DEFAULTS = { intervalMinutes: 60, windowHours: 14, maxAttemptsPerDay: 3, logonRetryMinutes: 10, logonRetryWindowMinutes: 60, runScript: '', actionVbs: '', enabled: true }

export const scheduleFile = () => process.env.HAC_SCHEDULE_FILE || path.join(REPO_DIR, 'config', 'schedule.json')
export const exampleFile = () => path.join(REPO_DIR, 'config', 'schedule.example.json')

function stripMeta(value) {
    if (Array.isArray(value)) return value.map(stripMeta)
    if (!value || typeof value !== 'object') return value
    const out = {}
    for (const [k, v] of Object.entries(value)) if (!k.startsWith('_')) out[k] = stripMeta(v)
    return out
}

function readJson(file) {
    if (!fs.existsSync(file)) return null
    try {
        return stripMeta(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch (err) {
        throw new ScheduleError(`${file} 不是合法 JSON:${err.message}`)
    }
}

function shallowMerge(base, over) {
    const out = { ...base, ...over, stagger: { ...base.stagger, ...over.stagger }, linux: { ...base.linux, ...over.linux }, programs: {} }
    for (const id of new Set([...Object.keys(base.programs || {}), ...Object.keys(over.programs || {})])) {
        out.programs[id] = { ...PROGRAM_DEFAULTS, ...(base.programs?.[id] || {}), ...(over.programs?.[id] || {}) }
    }
    return out
}

/** 读配置:example 出默认值,schedule.json 覆盖它,都没有就用 HARD_DEFAULTS。 */
export function loadSchedule() {
    const warnings = []
    const example = readJson(exampleFile())
    const live = readJson(scheduleFile())
    let raw = example || HARD_DEFAULTS
    let source = example ? 'config/schedule.example.json' : '内置默认值'
    if (live) {
        raw = shallowMerge(raw, live)
        source = `${scheduleFile()} 覆盖 ${source}`
    } else {
        warnings.push(`没找到 ${scheduleFile()} —— 用默认值;要自定义就复制 config/schedule.example.json 过去`)
    }
    return { schedule: normalize(raw), source, warnings }
}

const isInt = (v) => Number.isInteger(v)
export function parseTime(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''))
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
    return Number(m[1]) * 60 + Number(m[2])
}
export function fmtTime(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
/** 分钟数 -> Windows 任务的 ISO8601 时长:120 -> PT2H,3 -> PT3M。 */
export function isoDuration(minutes) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}` || 'PT0M'
}

// [字段, 最小, 最大] —— 整数校验表
const INT_RULES = [
    ['intervalMinutes', 5, Infinity],
    ['maxAttemptsPerDay', 1, Infinity],
    ['logonRetryMinutes', 1, Infinity]
]

/** 校验 + 归一化;auto 的 startTime / logonDelayMinutes 在这里按 order 与 stagger 推导。 */
export function normalize(raw) {
    const errors = []
    const notes = []
    const stagger = { ...HARD_DEFAULTS.stagger, ...(raw.stagger || {}) }
    if (!parseTime(stagger.baseStartTime)) errors.push(`stagger.baseStartTime 不是 HH:MM:${stagger.baseStartTime}`)
    for (const key of ['slotMinutes', 'logonBaseMinutes', 'logonStepMinutes']) if (!isInt(stagger[key]) || stagger[key] < 0) errors.push(`stagger.${key} 必须是非负整数:${stagger[key]}`)
    const order = Array.isArray(raw.order) ? raw.order.map(String) : []
    if (new Set(order).size !== order.length) errors.push('order 里有重复项')
    const programs = raw.programs || {}
    if (!Object.keys(programs).length) errors.push('programs 是空的')

    const resolved = {}
    // order 里的先跑,没登记的接在后面 —— 下标决定错峰槽位与登录延迟
    const ids = [...order, ...Object.keys(programs).filter((k) => !order.includes(k))]
    for (const id of ids) {
        const p = programs[id]
        if (!p) {
            errors.push(`order 里的 ${id} 在 programs 里没有定义`)
            continue
        }
        const index = Math.max(0, ids.indexOf(id))
        const start =
            p.startTime === undefined || p.startTime === 'auto'
                ? (parseTime(stagger.baseStartTime) ?? 0) + stagger.slotMinutes * index
                : parseTime(p.startTime)
        if (start === null || !Number.isFinite(start)) {
            errors.push(`${id}.startTime 不是 HH:MM 也不是 "auto":${p.startTime}`)
            continue
        }
        const delay =
            p.logonDelayMinutes === undefined || p.logonDelayMinutes === 'auto'
                ? stagger.logonBaseMinutes + stagger.logonStepMinutes * index
                : p.logonDelayMinutes
        if (!isInt(delay) || delay < 0 || delay > 1440) errors.push(`${id}.logonDelayMinutes 必须是 0-1440 的整数或 "auto"`)
        for (const [key, lo] of INT_RULES) if (!isInt(p[key]) || p[key] < lo) errors.push(`${id}.${key} 必须是 >=${lo} 的整数:${p[key]}`)
        if (!(typeof p.windowHours === 'number' && p.windowHours > 0)) errors.push(`${id}.windowHours 必须是正数`)
        if (isInt(p.logonRetryWindowMinutes) && isInt(p.logonRetryMinutes) && p.logonRetryWindowMinutes < p.logonRetryMinutes) {
            errors.push(`${id}.logonRetryWindowMinutes 必须 >= logonRetryMinutes`)
        }
        if (errors.length) continue
        const windowMinutes = Math.round(p.windowHours * 60)
        const opportunities = Math.floor((windowMinutes - 1) / p.intervalMinutes) + 1
        if (opportunities < p.maxAttemptsPerDay) {
            notes.push(`${id}:窗口里只有 ${opportunities} 次触发机会,少于 maxAttemptsPerDay=${p.maxAttemptsPerDay}`)
        }
        resolved[id] = {
            id,
            order: index,
            taskName: String(p.taskName || id),
            startTime: fmtTime(start),
            startMinutes: start,
            intervalMinutes: p.intervalMinutes,
            windowHours: p.windowHours,
            windowMinutes,
            maxAttemptsPerDay: p.maxAttemptsPerDay,
            logonDelayMinutes: delay,
            logonRetryMinutes: p.logonRetryMinutes,
            logonRetryWindowMinutes: p.logonRetryWindowMinutes,
            runScript: String(p.runScript || ''),
            actionVbs: String(p.actionVbs || ''),
            enabled: p.enabled !== false,
            opportunities
        }
    }
    const linux = normalizeLinux(raw.linux, errors)
    if (errors.length) throw new ScheduleError(`调度配置有 ${errors.length} 处问题:\n  - ${errors.join('\n  - ')}`)
    const timezone = String(raw.timezone || HARD_DEFAULTS.timezone)
    return { version: raw.version ?? 1, timezone, linux, order: Object.keys(resolved).sort((a, b) => resolved[a].order - resolved[b].order), stagger, programs: resolved, notes }
}

/** 一行话,给人和报告看。 */
export const describe = (p) =>
    `${p.startTime} 起每 ${p.intervalMinutes}m,窗口 ${p.windowHours}h(${p.opportunities} 次机会;最多真跑 ${p.maxAttemptsPerDay} 次)` +
    ` | 登录后 ${p.logonDelayMinutes}m,${p.logonRetryWindowMinutes}m 内每 ${p.logonRetryMinutes}m`

/** 机器可读的期望触发器,deploy-*.sh 拿它与实际任务比对(键与 task_expect 一致)。 */
export const expectation = (p) =>
    [`start=${p.startTime}`, `delay=${isoDuration(p.logonDelayMinutes)}`, `interval=${isoDuration(p.intervalMinutes)}`, `duration=${isoDuration(p.windowMinutes)}`].join('\n')

const [, , cmd, arg] = process.argv
// 只在被直接执行时当 CLI;被 apply-schedule.mjs import 时不动 argv。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain && cmd) {
    try {
        const { schedule, source, warnings } = loadSchedule()
        for (const w of warnings) console.error(`[警告] ${w}`)
        console.error(`[配置] ${source}`)
        for (const n of schedule.notes) console.error(`[注意] ${n}`)
        if (cmd === 'show') {
            for (const id of schedule.order) console.log(`${id.padEnd(20)} ${schedule.programs[id].taskName.padEnd(24)} ${describe(schedule.programs[id])}`)
        } else if (cmd === 'expect') {
            const p = schedule.programs[arg]
            if (!p) throw new ScheduleError(`没有这个程序:${arg}(有:${schedule.order.join(', ')})`)
            console.log(expectation(p))
        } else if (cmd === 'json') {
            console.log(JSON.stringify(schedule, null, 2))
        } else throw new ScheduleError(`未知命令:${cmd}`)
    } catch (err) {
        console.error(`[错误] ${err.message}`)
        process.exit(1)
    }
}
