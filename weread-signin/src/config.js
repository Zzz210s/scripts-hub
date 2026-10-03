// 读 .env 与默认值,产出规范化配置。零依赖,缺失项一律给可用默认值。
import fs from 'node:fs'
import path from 'node:path'

import { writeTextAtomic } from './atomic.js'

export const DEFAULTS = {
    apiKeyFile: 'secrets/weread-api-key.txt',
    curlFile: 'secrets/read-request.curl',
    botScript: 'vendor/weread-bot/weread-bot.py',
    botConfig: 'config.yaml',
    webhookFile: 'secrets/wecom-webhook.txt',
    challengeStart: '',
    challengeEndsOn: '',
    requiredMinutes: 1800,      // 30 小时
    requiredValidDays: 29,
    minValidMinutes: 5,         // 挑战口径:当天 > 5 分钟算有效日
    slackMinutes: 6,            // 统计漏计的余量
    dailyCapMinutes: 120,
    sectionMinutes: 30,
    quietStart: '20:00',
    quietEnd: '23:00',
    shutdownTime: '02:00',
    shutdownGuardMinutes: 30,
    maxAttemptsPerDay: 3,        // 每天最多尝试几次(守卫与“今天还能跑多久”共用)
    runTimeoutMinutes: 100,
    accountName: '微信读书',
    busyPeers: ''
}

export function parseEnv(text) {
    const out = {}
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq < 1) continue
        let value = line.slice(eq + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }
        out[line.slice(0, eq).trim()] = value
    }
    return out
}

function toInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) ? parsed : fallback
}

/** 读配置;文件不存在时用默认值(便于在没有 .env 的机器上跑测试)。 */
export function loadConfig(envPath = '.env') {
    const env = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {}
    const pick = (key, fallback) => (env[key] === undefined || env[key] === '' ? fallback : env[key])

    return {
        apiKeyFile: pick('WEREAD_API_KEY_FILE', DEFAULTS.apiKeyFile),
        curlFile: pick('WEREAD_CURL_FILE', DEFAULTS.curlFile),
        botScript: pick('WEREAD_BOT', DEFAULTS.botScript),
        botConfig: pick('WEREAD_BOT_CONFIG', DEFAULTS.botConfig),
        webhookFile: pick('WECOM_WEBHOOK_FILE', DEFAULTS.webhookFile),
        challengeStart: pick('CHALLENGE_START', DEFAULTS.challengeStart),
        challengeEndsOn: pick('CHALLENGE_ENDS_ON', DEFAULTS.challengeEndsOn),
        requiredMinutes: toInt(env.REQUIRED_MINUTES, DEFAULTS.requiredMinutes),
        requiredValidDays: toInt(env.REQUIRED_VALID_DAYS, DEFAULTS.requiredValidDays),
        minValidMinutes: toInt(env.MIN_VALID_MINUTES, DEFAULTS.minValidMinutes),
        slackMinutes: toInt(env.SLACK_MINUTES, DEFAULTS.slackMinutes),
        dailyCapMinutes: toInt(env.DAILY_CAP_MINUTES, DEFAULTS.dailyCapMinutes),
        sectionMinutes: toInt(env.SECTION_MINUTES, DEFAULTS.sectionMinutes),
        quietStart: pick('QUIET_START', DEFAULTS.quietStart),
        quietEnd: pick('QUIET_END', DEFAULTS.quietEnd),
        shutdownTime: pick('SHUTDOWN_TIME', DEFAULTS.shutdownTime),
        shutdownGuardMinutes: toInt(env.SHUTDOWN_GUARD_MINUTES, DEFAULTS.shutdownGuardMinutes),
        maxAttemptsPerDay: toInt(env.MAX_ATTEMPTS_PER_DAY, DEFAULTS.maxAttemptsPerDay),
        runTimeoutMinutes: toInt(env.RUN_TIMEOUT_MINUTES, DEFAULTS.runTimeoutMinutes),
        accountName: pick('ACCOUNT_NAME', DEFAULTS.accountName),
        // 同伴程序(错峰用):逗号分隔的 run-state.js 路径,任一在跑就跳过本次
        busyPeers: pick('BUSY_PEERS', DEFAULTS.busyPeers).split(',').map(item => item.trim()).filter(Boolean)
    }
}

/** 挑战窗口没配时,给一个"从今天起算"的兜底,并在结果里说明。 */
export function ensureWindow(config, today) {
    if (config.challengeStart && config.challengeEndsOn) return { ...config, windowAssumed: false }
    const start = new Date(`${today}T00:00:00`)
    const end = new Date(start.getTime() + 29 * 86400000)
    const pad = value => String(value).padStart(2, '0')
    const iso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    return { ...config, challengeStart: config.challengeStart || today, challengeEndsOn: config.challengeEndsOn || iso(end), windowAssumed: true }
}

/** 把今天的目标写回底座的 config.yaml(它只认 "最小-最大" 这样的区间)。 */
export function patchTargetDuration(configPath, targetMinutes) {
    const low = Math.max(1, targetMinutes - 2)
    const high = targetMinutes + 4
    const text = fs.readFileSync(configPath, 'utf8')
    const pattern = /target_duration: "\d+-\d+"/
    if (!pattern.test(text)) throw new Error(`未能在 ${configPath} 里找到 target_duration`)
    const next = text.replace(pattern, `target_duration: "${low}-${high}"`)
    // 目标与上一次相同时不必重写文件(每天的目标经常不变)
    if (next !== text) writeTextAtomic(configPath, next)
    return { low, high, changed: next !== text }
}

/** 把账号名写进底座的 config.yaml(多用户模式下它才会用真实名字打日志与通知)。 */
export function patchAccountName(configPath, name) {
    if (!name) return { changed: false }
    const text = fs.readFileSync(configPath, 'utf8')
    const pattern = /- name: "[^"]*"/
    if (!pattern.test(text)) return { changed: false, reason: 'config.yaml 里没有 - name: "..."' }
    const next = text.replace(pattern, `- name: "${name}"`)
    if (next !== text) writeTextAtomic(configPath, next)
    return { changed: next !== text, name }
}

export function resolvePath(file) {
    return path.isAbsolute(file) ? file : path.resolve(file)
}
