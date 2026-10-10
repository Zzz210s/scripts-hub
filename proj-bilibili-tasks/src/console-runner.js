// 拉上游 .NET Console:注入任务开关矩阵,收 stdout,超时杀。
// 开关矩阵是双保险:既不在 RunTasks 里出现,又显式 IsEnable=false。
import { spawn as nodeSpawn } from 'node:child_process'
import { loadConfig } from './config.js'

export const RUN_TASKS = 'Daily&VipBigPoint&Manga&MangaPrivilege'
const SINK_RE = /^(Ray_)?Serilog__WriteTo/i

export class ConfigError extends Error {
    constructor(message) {
        super(message)
        this.name = 'ConfigError'
        this.code = 'config-invalid'
    }
}

/** D15 前置断言:上游 13 个通知 sink 全靠「不设」来关,这里把它变成硬检查。 */
export function assertNoSinks(env, processEnv = process.env) {
    for (const source of [env, processEnv]) {
        for (const [key, value] of Object.entries(source ?? {})) {
            if (SINK_RE.test(key) && String(value ?? '').trim() !== '') {
                throw new ConfigError(`检测到非空的 ${key},上游通知 sink 必须全关`)
            }
        }
    }
}

/** 设计文档 §6.2/§6.3 的开关矩阵;投币数量与保留值来自薄壳算出的策略。 */
export function buildConsoleEnv(cfg, { coinTarget } = {}) {
    const target = coinTarget ?? { target: cfg.coinMax }
    return {
        Ray_RunTasks: RUN_TASKS,
        Ray_DailyTaskConfig__IsEnable: 'true',
        Ray_VipBigPointConfig__IsEnable: 'true',
        Ray_MangaTaskConfig__IsEnable: 'true',
        Ray_MangaPrivilegeTaskConfig__IsEnable: 'true',
        Ray_VipPrivilegeConfig__IsEnable: 'false',
        Ray_ChargeTaskConfig__IsEnable: 'false',
        Ray_Silver2CoinTaskConfig__IsEnable: 'false',
        Ray_UnfollowBatchedTaskConfig__IsEnable: 'false',
        Ray_LiveFansMedalTaskConfig__IsEnable: 'false',
        Ray_LiveLotteryTaskConfig__IsEnable: 'false',
        Ray_DailyTaskConfig__IsWatchVideo: 'true',
        Ray_DailyTaskConfig__IsShareVideo: 'true',
        Ray_DailyTaskConfig__SelectLike: 'false',
        Ray_DailyTaskConfig__NumberOfCoins: String(target.target),
        Ray_DailyTaskConfig__NumberOfProtectedCoins: String(cfg.coinKeep),
        Ray_DailyTaskConfig__SupportUpIds: '',
        Ray_Security__RandomSleepMaxMin: '0',
        Ray_AutoRecoverConfig__IsEnable: 'false'
    }
}

/** 跑一次 Console。tasks 会覆盖 env.Ray_RunTasks;返回 {code, stdout, stderr, timedOut}。 */
export function runConsole(tasks, env = {}, deps = {}) {
    assertNoSinks(env)
    const config = deps.config ?? loadConfig()
    const spawnImpl = deps.spawnImpl ?? nodeSpawn
    const childEnv = { ...process.env, ...env, Ray_RunTasks: tasks ?? env.Ray_RunTasks }
    const timeoutMinutes = deps.timeoutMinutes ?? config.consoleTimeoutMinutes

    return new Promise((resolve) => {
        const child = spawnImpl('dotnet', [config.consoleDll], {
            cwd: deps.cwd ?? config.consoleDir,
            env: childEnv,
            stdio: ['ignore', 'pipe', 'pipe']
        })
        let stdout = ''
        let stderr = ''
        let timedOut = false
        let done = false
        const finish = (payload) => {
            if (done) return
            done = true
            clearTimeout(timer)
            resolve(payload)
        }
        const timer = setTimeout(() => {
            timedOut = true
            try { child.kill('SIGKILL') } catch { /* 已经退出 */ }
        }, timeoutMinutes * 60000)

        const handle = (chunk, stream) => {
            const text = String(chunk)
            if (stream === 'out') stdout += text
            else stderr += text
            if (deps.onLine) for (const line of text.split(/\r?\n/)) if (line.trim()) deps.onLine(line, stream)
        }
        child.stdout?.on('data', (chunk) => handle(chunk, 'out'))
        child.stderr?.on('data', (chunk) => handle(chunk, 'err'))
        child.on('error', (error) => finish({ code: null, stdout, stderr, timedOut: false, error: error.message }))
        child.on('close', (code) => finish({ code, stdout, stderr, timedOut }))
    })
}
