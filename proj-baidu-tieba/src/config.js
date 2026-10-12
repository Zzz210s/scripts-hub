// Task 9 配置读取:`.env` 是账号与可调项的真源,显式 env 覆盖文件里的同名键。
// 零依赖;缺失项一律给可用默认值 —— 读不到 .env 也能跑,便于离线测试与首次部署。
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = {
  intervalMs: 2000,
  maxAttempts: 3,
  quietStart: '20:00',
  quietEnd: '23:00',
  shutdownTime: '02:00',
  shutdownMarginMinutes: 30,
  minFreeMb: 800,
  boundaryHour: 4,
  webhookFile: 'secrets/wecom-webhook.txt',
  stateDir: 'data',
};

/** 读 .env 文本成对象:跳过注释与空行,剥掉成对的引号。 */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const pick = (env, key, fallback) => (env[key] === undefined || env[key] === '' ? fallback : env[key]);

const int = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * 账号列表:`ACCOUNT_n_BDUSS` 是必需键,按 n 的数值升序(不是字典序,ACCOUNT_10 在 ACCOUNT_2 之后)。
 * cookie 串只由 BDUSS 与可选 STOKEN 组成;`ACCOUNT_n_NAME` 只影响消息里的显示名。
 */
export function accountsFrom(env) {
  const found = [];
  for (const key of Object.keys(env)) {
    const matched = /^ACCOUNT_(\d+)_BDUSS$/.exec(key);
    if (!matched) continue;
    const index = Number(matched[1]);
    const bduss = String(env[key]).trim();
    if (!bduss) continue;
    const stoken = String(env[`ACCOUNT_${index}_STOKEN`] ?? '').trim();
    found.push({
      index,
      name: String(pick(env, `ACCOUNT_${index}_NAME`, `账号 ${index}`)),
      cookie: stoken ? `BDUSS=${bduss}; STOKEN=${stoken}` : `BDUSS=${bduss}`,
    });
  }
  return found.sort((a, b) => a.index - b.index).map((account) => ({ name: account.name, cookie: account.cookie }));
}

/** 目标吧白名单:`TIEBA_FORUMS` 逗号分隔;空 = 签全部已关注吧,用 null 表示「不过滤」。 */
function filterFrom(env) {
  const raw = String(pick(env, 'TIEBA_FORUMS', '')).trim();
  if (!raw) return null;
  const list = raw.split(',').map((item) => item.trim()).filter(Boolean);
  return list.length ? list : null;
}

/** 读配置。cwd 决定 stateDir / webhookFile 的相对根;显式 env 覆盖 .env 文件。 */
export function loadConfig(cwd = process.cwd(), { env = process.env, fsImpl = fs } = {}) {
  const file = path.join(cwd, '.env');
  const fromFile = fsImpl.existsSync(file) ? parseEnv(fsImpl.readFileSync(file, 'utf8')) : {};
  const merged = { ...fromFile, ...(env ?? {}) };
  const stateDir = String(pick(merged, 'TIEBA_STATE_DIR', DEFAULTS.stateDir));
  const webhookFile = String(pick(merged, 'TIEBA_WEBHOOK_FILE', DEFAULTS.webhookFile));
  return {
    cwd,
    accounts: accountsFrom(merged),
    filter: filterFrom(merged),
    intervalMs: int(pick(merged, 'TIEBA_INTERVAL_MS', null), DEFAULTS.intervalMs),
    maxAttempts: int(pick(merged, 'TIEBA_MAX_ATTEMPTS', null), DEFAULTS.maxAttempts),
    quietStart: String(pick(merged, 'TIEBA_QUIET_START', DEFAULTS.quietStart)),
    quietEnd: String(pick(merged, 'TIEBA_QUIET_END', DEFAULTS.quietEnd)),
    shutdownTime: String(pick(merged, 'TIEBA_SHUTDOWN_TIME', DEFAULTS.shutdownTime)),
    shutdownMarginMinutes: int(pick(merged, 'TIEBA_SHUTDOWN_MARGIN_MINUTES', null), DEFAULTS.shutdownMarginMinutes),
    minFreeMb: int(pick(merged, 'TIEBA_MIN_FREE_MB', null), DEFAULTS.minFreeMb),
    boundaryHour: int(pick(merged, 'TIEBA_DAY_BOUNDARY_HOUR', null), DEFAULTS.boundaryHour),
    stateDir: path.isAbsolute(stateDir) ? stateDir : path.join(cwd, stateDir),
    webhookFile: path.isAbsolute(webhookFile) ? webhookFile : path.join(cwd, webhookFile),
    busyPeers: String(pick(merged, 'BUSY_PEERS', '')).split(',').map((item) => item.trim()).filter(Boolean),
    dryRun: merged.TIEBA_DRY_RUN === '1',
  };
}
