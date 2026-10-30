// 只读探针:把 newmoindex 返回的每个吧的**全部字段**摊开,找「经验值」到底在哪。
//
// 背景:要按「各吧距下一级还差多少经验」排发帖量,就必须先确认接口给不给经验。
// 只知道等级不够 —— 等级是阶段,经验才是进度。
//
// 用法(容器内,凭据从 .env 注入):
//   node tools/probe-forum-fields.mjs            # 汇总字段 + 前 5 个吧的原始条目
//   node tools/probe-forum-fields.mjs --all      # 逐个吧打印
//
// 只做 GET,不改任何状态。

import { readFileSync } from 'node:fs';

// 自带传输层:探针要能在只挂一个文件的容器里跑,不依赖应用目录结构。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function request(url, { cookie, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      'User-Agent': UA,
      Referer: 'https://tieba.baidu.com/',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  try {
    return { ok: true, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: false, reason: 'parse', status: res.status, error: text.slice(0, 120) };
  }
}

const SESSION = 'https://tieba.baidu.com/mo/q/newmoindex';
const ALL = process.argv.includes('--all');

// 凭据来源:容器里 .env 是挂进来给应用自己解析的(compose 没设 env_file),
// 所以探针也直接读文件,不指望环境变量。
function readEnvFile() {
  const candidates = [process.env.TIEBA_ENV, '/opt/tieba/.env', './.env'].filter(Boolean);
  for (const file of candidates) {
    try {
      const text = readFileSync(file, 'utf8');
      const out = {};
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
        if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      if (out.ACCOUNT_1_BDUSS) return out;
    } catch {
      /* 换下一个候选 */
    }
  }
  return null;
}

function envCookie(env) {
  const bduss = env?.ACCOUNT_1_BDUSS ?? '';
  const stoken = env?.ACCOUNT_1_STOKEN ?? '';
  if (!bduss) return null;
  return stoken ? `BDUSS=${bduss}; STOKEN=${stoken}` : `BDUSS=${bduss}`;
}

/** 递归找「像经验/积分/等级」的键,值和它所在的键一起打印。 */
function collectKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...collectKeys(v, key));
    else if (!Array.isArray(v)) out.push([key, v]);
  }
  return out;
}

function summarize(entry) {
  return Object.entries(entry).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
}

const cookie = envCookie(readEnvFile());
if (!cookie) {
  console.error('缺 ACCOUNT_1_BDUSS:探针读不到 .env');
  process.exit(2);
}

const res = await request(SESSION, { cookie });
if (!res.ok) {
  console.error(`取会话失败:${res.reason} ${res.error ?? ''}`);
  process.exit(1);
}

const data = res.data?.data ?? {};
const forums = Array.isArray(data.like_forum) ? data.like_forum : [];
console.log(`账号 uid=${data.uid ?? '?'} · 关注吧 ${forums.length} 个`);
console.log(`B站类推的顶层字段:${Object.keys(data).join(', ')}`);

// 1) 所有出现过的键,以及它们在多少个吧里出现
const keyCount = new Map();
for (const f of forums) {
  for (const [k, v] of collectKeys(f)) {
    const type = v === null ? 'null' : typeof v;
    const prev = keyCount.get(k) ?? { n: 0, type };
    keyCount.set(k, { n: prev.n + 1, type });
  }
}
console.log(`\n字段清单(共 ${keyCount.size} 个);带 exp/score/point/level 的重点看:`);
for (const [k, { n, type }] of [...keyCount].sort()) {
  const hot = /exp|score|point|level|grade/i.test(k) ? ' <=' : '';
  console.log(`  ${k}  x${n}  ${type}${hot}`);
}

// 2) 原始条目
const sample = ALL ? forums : forums.slice(0, 5);
console.log(`\n原始条目 ${ALL ? '全部' : `前 ${sample.length} 个`}:`);
for (const f of sample) {
  console.log(`  ${summarize(f).join(' | ')}`);
}

// 3) 经验字段拿去做「距下一级」估算时,先看它的取值范围,判断单位是经验还是别的
for (const key of ['user_exp', 'user_exp_sign', 'level_id', 'user_level', 'cur_score']) {
  const vals = forums.map((f) => Number(f[key])).filter((n) => Number.isFinite(n));
  if (!vals.length) continue;
  console.log(
    `\n${key}: ${vals.length} 个有值 · 最小 ${Math.min(...vals)} · 最大 ${Math.max(...vals)}`
  );
}

// 4) 顺手确认 csrf 用的 itb_tbs 长度(发帖要 tbs)
const tbs = data.itb_tbs ?? null;
console.log(`\nitb_tbs=${tbs ? `${String(tbs).slice(0, 6)}… 长度 ${String(tbs).length}` : '缺失'}`);
