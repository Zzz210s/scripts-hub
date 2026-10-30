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
  // 单实例锁另放 logs/:套件约定是「每个程序把锁写在 logs/run.lock」,同伴按这条路径能找到;
  // 状态与历史仍留 data/。见 proj-weread-signin/src/peer.js 的约定说明。
  lockDir: 'logs',
  // 逐吧明细:结果消息之后再发一条「吧名 Lv8」一行一个的消息。默认开;条数上限防极端情况
  // (一个账号关注上千个吧时消息会拆成十几条)。
  detail: true,
  detailMax: 200,
  // 每日互动:每吧回帖条数上限 / 全局回帖上限 / 全局点赞上限 / 间隔 / 内容。
  // 真机实测每吧每天只给 4 点经验(第 5 条起 +0),所以 4 是有效上限,再高纯属浪费。
  interactPerForum: 4,
  interactMaxPosts: 544,
  interactMaxLikes: 136,
  interactIntervalMs: 3000,
  interactContent: '+3',
  // 单轮最多处理多少个吧。一天三次触发,45 × 3 刚好覆盖 136 个吧;
  // 一口气发几百条会被贴吧判「发帖太快」(no=271 / 8009 都是这个)。
  interactMaxForums: 45,
};

/** 读 .env;不存在或读不动一律当空(容器挂载点缺失时 Docker 会把它建成目录,见 loadConfig)。 */
function readEnvFile(file, fsImpl) {
  try {
    return fsImpl.existsSync(file) ? fsImpl.readFileSync(file, 'utf8') : '';
  } catch {
    return '';
  }
}

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

/** 解析整数:非数字或低于下界(min)一律回落默认值。有些键的 0 无意义(见 maxAttempts)。 */
const int = (value, fallback, min = 0) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};

/**
 * 账号列表:`ACCOUNT_n_BDUSS` 是必需键,按 n 的数值升序(不是字典序,ACCOUNT_10 在 ACCOUNT_2 之后)。
 * cookie 串只由 BDUSS 与可选 STOKEN 组成;`ACCOUNT_n_NAME` 只影响消息里的显示名。
 *
 * 每个账号带一个**唯一 `id`**(`acct-<n>`)—— 全链路(凭据体检 / 读回列表 / 对账)都以它
 * 为键,显示名只用于渲染。两个账号同名时若拿名字当键,靠后的账号会覆盖靠前的:轻则
 * 可用账号被当成失效而整天不签,重则把「其实没签全」误报成 `ok:true` 并锁死当天。
 * 同名的显示名在这里顺带消歧(`名字 #n`),让消息里的人也能分清是哪一条。
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
  const used = new Set();
  return found
    .sort((a, b) => a.index - b.index)
    .map((account) => {
      const name = used.has(account.name) ? `${account.name} #${account.index}` : account.name;
      used.add(account.name);
      used.add(name);
      return { id: `acct-${account.index}`, name, cookie: account.cookie };
    });
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
  // 读不动就当没有:容器挂载点在宿主上不存在时,Docker 会把它建成**目录**,readFileSync 抛 EISDIR。
  // 那时正确的表现是「没有配置任何账号」这句人话,而不是一条 EISDIR 让人去猜挂载。
  const fromFile = parseEnv(readEnvFile(file, fsImpl));
  const merged = { ...fromFile, ...(env ?? {}) };
  const stateDir = String(pick(merged, 'TIEBA_STATE_DIR', DEFAULTS.stateDir));
  const lockDir = String(pick(merged, 'TIEBA_LOCK_DIR', DEFAULTS.lockDir));
  const webhookFile = String(pick(merged, 'TIEBA_WEBHOOK_FILE', DEFAULTS.webhookFile));
  return {
    cwd,
    accounts: accountsFrom(merged),
    filter: filterFrom(merged),
    intervalMs: int(pick(merged, 'TIEBA_INTERVAL_MS', null), DEFAULTS.intervalMs),
    // 下界 1:`TIEBA_MAX_ATTEMPTS=0` 会让 attempts-exhausted 守卫恒真 —— 每天只推一条 action、永远不签。
    maxAttempts: int(pick(merged, 'TIEBA_MAX_ATTEMPTS', null), DEFAULTS.maxAttempts, 1),
    quietStart: String(pick(merged, 'TIEBA_QUIET_START', DEFAULTS.quietStart)),
    quietEnd: String(pick(merged, 'TIEBA_QUIET_END', DEFAULTS.quietEnd)),
    shutdownTime: String(pick(merged, 'TIEBA_SHUTDOWN_TIME', DEFAULTS.shutdownTime)),
    shutdownMarginMinutes: int(pick(merged, 'TIEBA_SHUTDOWN_MARGIN_MINUTES', null), DEFAULTS.shutdownMarginMinutes),
    minFreeMb: int(pick(merged, 'TIEBA_MIN_FREE_MB', null), DEFAULTS.minFreeMb),
    boundaryHour: int(pick(merged, 'TIEBA_DAY_BOUNDARY_HOUR', null), DEFAULTS.boundaryHour),
    stateDir: path.isAbsolute(stateDir) ? stateDir : path.join(cwd, stateDir),
    lockDir: path.isAbsolute(lockDir) ? lockDir : path.join(cwd, lockDir),
    webhookFile: path.isAbsolute(webhookFile) ? webhookFile : path.join(cwd, webhookFile),
    busyPeers: String(pick(merged, 'BUSY_PEERS', '')).split(',').map((item) => item.trim()).filter(Boolean),
    // 只有显式写 `0` 才关;不写/写错一律当开 —— 用户要的就是每天能看到逐吧明细。
    detail: String(pick(merged, 'TIEBA_DETAIL', '1')) !== '0',
    // 下界 1:0 会让明细只剰一句「另有 N 个未列出」,没意义。
    detailMax: int(pick(merged, 'TIEBA_DETAIL_MAX', null), DEFAULTS.detailMax, 1),
    // 互动默认开;显式 `0` 才关。回帖是有副作用的行为,关掉它应该只用一条环境变量。
    interact: String(pick(merged, 'TIEBA_INTERACT', '1')) !== '0',
    // 上界 4:实测第 5 条起不给经验,写再大也只是多发垃圾。
    interactPerForum: Math.min(int(pick(merged, 'TIEBA_INTERACT_PER_FORUM', null), DEFAULTS.interactPerForum, 0), 4),
    interactMaxPosts: int(pick(merged, 'TIEBA_INTERACT_MAX_POSTS', null), DEFAULTS.interactMaxPosts, 0),
    interactMaxLikes: int(pick(merged, 'TIEBA_INTERACT_MAX_LIKES', null), DEFAULTS.interactMaxLikes, 0),
    interactIntervalMs: int(pick(merged, 'TIEBA_INTERACT_INTERVAL_MS', null), DEFAULTS.interactIntervalMs, 0),
    interactContent: String(pick(merged, 'TIEBA_INTERACT_CONTENT', DEFAULTS.interactContent)),
    interactMaxForums: int(pick(merged, 'TIEBA_INTERACT_MAX_FORUMS', null), DEFAULTS.interactMaxForums, 0),
    dryRun: merged.TIEBA_DRY_RUN === '1',
  };
}
