// Task 2 配置读取:`.env` 是账号与可调项的真源,显式 env 覆盖文件里的同名键。
// 零依赖;缺失项一律给可用默认值 —— 读不到 .env 也能跑,便于离线测试与首次部署。
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_LIMITS } from './guards.js'

export const DEFAULTS = {
  // 设计硬约束:请求间隔 >=3 秒(单账号串行、每日一次)。
  requestIntervalMs: 3000,
  timeoutMs: 10000,
  boundaryHour: 4,
  stateDir: 'data',
  // 单实例锁另放 logs/:套件约定是「每个程序把锁写在 logs/run.lock」,同伴按这条路径能找到。
  lockDir: 'logs',
  webhookFile: 'secrets/wecom-webhook.txt',
  // 守卫阈值(含 attempts-exhausted 的 maxAttempts)不在本文件重抄:直接展开 guards.js 的
  // DEFAULT_LIMITS —— 只有一份字面量真源,改 guards.js 立即生效。
  // 放这里是为了能按机器调,守卫本身不读环境。
  ...DEFAULT_LIMITS,
}

/** 读 .env;不存在或读不动一律当空(容器挂载点缺失时 Docker 会把它建成目录,见 loadConfig)。 */
function readEnvFile(file, fsImpl) {
  try {
    return fsImpl.existsSync(file) ? fsImpl.readFileSync(file, 'utf8') : ''
  } catch {
    return ''
  }
}

/** 读 .env 文本成对象:跳过注释与空行,剥掉成对的引号。 */
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

const pick = (env, key, fallback) => (env[key] === undefined || env[key] === '' ? fallback : env[key])

/** 解析整数:非数字或低于下界(min)一律回落默认值。 */
const int = (value, fallback, min = 0) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

/**
 * 账号列表:`ACCOUNT_n_MUSIC_U` 是必需键,按 n 的数值升序(不是字典序,ACCOUNT_10 在 ACCOUNT_2 之后)。
 * 只认 MUSIC_U —— 设计硬约束:MUSIC_A 是未登录态 cookie,不作运行时回退,见到也忽略。
 * 每个账号带唯一 `id`(`acct-<n>`),全链路以它为键;显示名只用于渲染,同名时顺带消歧。
 */
export function accountsFrom(env) {
  const found = []
  for (const key of Object.keys(env)) {
    const matched = /^ACCOUNT_(\d+)_MUSIC_U$/.exec(key)
    if (!matched) continue
    const index = Number(matched[1])
    const musicU = String(env[key]).trim()
    if (!musicU) continue
    found.push({ index, musicU })
  }
  const used = new Set()
  return found
    .sort((a, b) => a.index - b.index)
    .map((account) => {
      const base = String(pick(env, `ACCOUNT_${account.index}_NAME`, `账号 ${account.index}`))
      const name = used.has(base) ? `${base} #${account.index}` : base
      used.add(base)
      used.add(name)
      return { id: `acct-${account.index}`, name, cookie: `MUSIC_U=${account.musicU}` }
    })
}

const asPath = (cwd, value) => (path.isAbsolute(value) ? value : path.join(cwd, value))

/** 读配置。cwd 决定 stateDir / webhookFile 的相对根;显式 env 覆盖 .env 文件。 */
export function loadConfig(cwd = process.cwd(), { env = process.env, fsImpl = fs } = {}) {
  const file = path.join(cwd, '.env')
  // 读不动就当没有:容器挂载点在宿主上不存在时,Docker 会把它建成**目录**,readFileSync 抛 EISDIR。
  // 那时正确的表现是「没有配置任何账号」这句人话,而不是一条 EISDIR 让人去猜挂载。
  const fromFile = parseEnv(readEnvFile(file, fsImpl))
  const merged = { ...fromFile, ...(env ?? {}) }
  return {
    cwd,
    accounts: accountsFrom(merged),
    timeoutMs: int(pick(merged, 'NETEASE_TIMEOUT_MS', null), DEFAULTS.timeoutMs, 1),
    requestIntervalMs: int(pick(merged, 'NETEASE_REQUEST_INTERVAL_MS', null), DEFAULTS.requestIntervalMs),
    boundaryHour: int(pick(merged, 'NETEASE_DAY_BOUNDARY_HOUR', null), DEFAULTS.boundaryHour),
    stateDir: asPath(cwd, String(pick(merged, 'NETEASE_STATE_DIR', DEFAULTS.stateDir))),
    lockDir: asPath(cwd, String(pick(merged, 'NETEASE_LOCK_DIR', DEFAULTS.lockDir))),
    webhookFile: asPath(cwd, String(pick(merged, 'NETEASE_WEBHOOK_FILE', DEFAULTS.webhookFile))),
    busyPeers: String(pick(merged, 'BUSY_PEERS', '')).split(',').map((item) => item.trim()).filter(Boolean),
    // 下界 1:`NETEASE_MAX_ATTEMPTS=0` 会让 attempts-exhausted 守卫恒真 —— 每天只推 action、永远不签。
    maxAttempts: int(pick(merged, 'NETEASE_MAX_ATTEMPTS', null), DEFAULTS.maxAttempts, 1),
    quietStart: String(pick(merged, 'NETEASE_QUIET_START', DEFAULTS.quietStart)),
    quietEnd: String(pick(merged, 'NETEASE_QUIET_END', DEFAULTS.quietEnd)),
    shutdownTime: String(pick(merged, 'NETEASE_SHUTDOWN_TIME', DEFAULTS.shutdownTime)),
    shutdownMarginMinutes: int(
      pick(merged, 'NETEASE_SHUTDOWN_MARGIN_MINUTES', null),
      DEFAULTS.shutdownMarginMinutes,
    ),
    minFreeMb: int(pick(merged, 'NETEASE_MIN_FREE_MB', null), DEFAULTS.minFreeMb),
    dryRun: merged.NETEASE_DRY_RUN === '1',
  }
}
