// 配置:`.env` 是开关与可调项的真源,`secrets/accounts.json` 是账号(每个账号一份 cookie 与 profile)。
// 零依赖;读不到 `.env` 也能跑 —— 首次部署时给人的表现应该是「没有账号」这句人话。
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULTS = {
  lng: 116.4074,
  lat: 39.9042,
  boundaryHour: 4,
  quietStart: '23:30',
  quietEnd: '06:30',
  maxClicks: 8,
  shotDir: 'logs',
  stateDir: 'data',
  secretsDir: 'secrets',
  webhookFile: 'secrets/wecom-webhook.txt',
  accountsFile: 'secrets/accounts.json',
  pageTimeoutSec: 40,
}

function readEnvFile(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
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
const num = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const int = (value, fallback, min = 0) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

/**
 * 账号列表。两种写法,后者优先:
 *   .env 里 ACCOUNT_1_COOKIE_FILE=... / ACCOUNT_1_NAME=...
 *   secrets/accounts.json = [{ "id":"a1", "name":"主号", "cookieFile":"...", "profile":"..." }]
 * 每个账号必须各有一份 cookie 与一个独立 profile —— 两个账号共用一个 profile 会互相顶掉登录态。
 */
export function loadAccounts({ cwd, env, accountsFile }) {
  const fromEnv = []
  for (const key of Object.keys(env)) {
    const matched = /^ACCOUNT_(\d+)_COOKIE_FILE$/.exec(key)
    if (!matched) continue
    const index = Number(matched[1])
    const cookieFile = String(env[key]).trim()
    if (!cookieFile) continue
    fromEnv.push({ index, id: `a${index}`, name: String(pick(env, `ACCOUNT_${index}_NAME`, `账号 ${index}`)), cookieFile, profile: '' })
  }
  fromEnv.sort((a, b) => a.index - b.index)

  const file = accountsFile
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      const list = Array.isArray(parsed) ? parsed : parsed.accounts
      if (Array.isArray(list) && list.length) {
        return list.map((one, i) => ({
          id: String(one.id ?? `a${i + 1}`),
          name: String(one.name ?? `账号 ${i + 1}`),
          cookieFile: path.resolve(cwd, one.cookieFile ?? `secrets/cookie-${one.id ?? i + 1}.txt`),
          profile: path.resolve(cwd, one.profile ?? `data/profile-${one.id ?? i + 1}`),
        }))
      }
    } catch { /* 坏 JSON 当没有,回落 .env */ }
  }
  return fromEnv.map((one) => ({
    ...one,
    cookieFile: path.resolve(cwd, one.cookieFile),
    profile: path.resolve(cwd, `data/profile-${one.id}`),
  }))
}

export function loadConfig(cwd = process.cwd(), { env = process.env } = {}) {
  const merged = { ...parseEnv(readEnvFile(path.join(cwd, '.env'))), ...env }
  const stateDir = String(pick(merged, 'SHANGGOU_STATE_DIR', DEFAULTS.stateDir))
  const dir = (value) => (path.isAbsolute(value) ? value : path.join(cwd, value))
  const config = {
    cwd,
    lng: num(pick(merged, 'SHANGGOU_LNG', null), DEFAULTS.lng),
    lat: num(pick(merged, 'SHANGGOU_LAT', null), DEFAULTS.lat),
    boundaryHour: int(pick(merged, 'SHANGGOU_DAY_BOUNDARY_HOUR', null), DEFAULTS.boundaryHour),
    quietStart: String(pick(merged, 'SHANGGOU_QUIET_START', DEFAULTS.quietStart)),
    quietEnd: String(pick(merged, 'SHANGGOU_QUIET_END', DEFAULTS.quietEnd)),
    maxClicks: int(pick(merged, 'SHANGGOU_MAX_CLICKS', null), DEFAULTS.maxClicks, 1),
    pageTimeoutSec: int(pick(merged, 'SHANGGOU_PAGE_TIMEOUT_SEC', null), DEFAULTS.pageTimeoutSec, 5),
    headless: String(pick(merged, 'SHANGGOU_HEADLESS', '1')) !== '0',
    chromePath: pick(merged, 'SHANGGOU_CHROME', ''),
    port: int(pick(merged, 'SHANGGOU_CDP_PORT', null), 9350, 1024),
    dryRun: merged.SHANGGOU_DRY_RUN === '1',
    stateDir: dir(stateDir),
    shotDir: dir(String(pick(merged, 'SHANGGOU_SHOT_DIR', DEFAULTS.shotDir))),
    secretsDir: dir(String(pick(merged, 'SHANGGOU_SECRETS_DIR', DEFAULTS.secretsDir))),
    webhookFile: dir(String(pick(merged, 'SHANGGOU_WEBHOOK_FILE', DEFAULTS.webhookFile))),
    accountsFile: dir(String(pick(merged, 'SHANGGOU_ACCOUNTS_FILE', DEFAULTS.accountsFile))),
    busyPeers: String(pick(merged, 'BUSY_PEERS', '')).split(',').map((one) => one.trim()).filter(Boolean),
  }
  config.accounts = loadAccounts({ cwd, env: merged, accountsFile: config.accountsFile })
  return config
}
