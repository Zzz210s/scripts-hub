// 探针:摸清「回帖」与「点赞」两个接口的真实形状。
//
// 为什么必须真调:这两个接口的路径、参数名、是否需要客户端签名,文档里没有可靠出处,
// 只能拿真账号试。默认 **不发帖**;加 --go 才真发一次 + 真点赞一次。
//
// 用法(容器内):
//   node /probe.mjs --forum 2ch            # 只读:拉帖子列表,看 tid 能不能拿到
//   node /probe.mjs --forum 2ch --go       # 真发 1 条 "+3" 并点 1 个赞
//
// 只依赖 node 内置模块,可以直接挂单个文件进容器跑。

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CLIENT_UA = 'bdtb for Android 12.0.0';
const TIEBA_APP_SECRET = 'tiebaclient!!!';

function args() {
  const out = { forum: '', go: false, replies: 0, likeScan: false, likeCombo: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--forum') out.forum = argv[++i];
    else if (argv[i] === '--go') out.go = true;
    else if (argv[i] === '--replies') out.replies = Number(argv[++i]);
    else if (argv[i] === '--like-scan') out.likeScan = true;
    else if (argv[i] === '--like-combo') out.likeCombo = true;
  }
  return out;
}

function readEnv() {
  for (const file of [process.env.TIEBA_ENV, '/opt/tieba/.env', './.env'].filter(Boolean)) {
    try {
      const out = {};
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
        if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      if (out.ACCOUNT_1_BDUSS) return out;
    } catch {
      /* 下一个候选 */
    }
  }
  return null;
}

/** 贴吧客户端签名:参数按键名排序拼成 a=1b=2,末尾接固定盐,MD5 后大写。 */
function clientSign(params) {
  const raw = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('') + TIEBA_APP_SECRET;
  return createHash('md5').update(raw).digest('hex').toUpperCase();
}

function cookieOf(env) {
  const bduss = env.ACCOUNT_1_BDUSS;
  return env.ACCOUNT_1_STOKEN ? `BDUSS=${bduss}; STOKEN=${env.ACCOUNT_1_STOKEN}` : `BDUSS=${bduss}`;
}

async function call(label, url, { cookie, form, ua = UA, method = form ? 'POST' : 'GET' } = {}) {
  const body = form ? new URLSearchParams(form).toString() : undefined;
  const res = await fetch(url, {
    method,
    headers: {
      'User-Agent': ua,
      Referer: 'https://tieba.baidu.com/',
      Cookie: cookie,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  console.log(`\n[${label}] ${method} ${url} -> HTTP ${res.status} · ${text.length} 字节`);
  console.log(`  ${text.slice(0, 400).replace(/\s+/g, ' ')}`);
  return { status: res.status, text };
}

const { forum, go, replies, likeScan, likeCombo } = args();
if (!forum) {
  console.error('用法:--forum <吧名> [--go]');
  process.exit(2);
}
const env = readEnv();
if (!env) {
  console.error('读不到 .env 里的 ACCOUNT_1_BDUSS');
  process.exit(2);
}
const cookie = cookieOf(env);

// 1) 会话:拿 tbs 与该吧的 fid / 当前经验
const sess = await fetch('https://tieba.baidu.com/mo/q/newmoindex', {
  headers: { 'User-Agent': UA, Referer: 'https://tieba.baidu.com/', Cookie: cookie },
  signal: AbortSignal.timeout(15000),
}).then((r) => r.json());
const info = (sess?.data?.like_forum ?? []).find((f) => f.forum_name === forum);
const tbs = sess?.data?.itb_tbs;
console.log(
  `会话 ok · tbs 长度 ${String(tbs ?? '').length} · ${forum} => fid=${info?.forum_id} Lv${info?.user_level} exp=${info?.user_exp}`
);
if (!info) {
  console.error(`关注列表里没有「${forum}」,换个吧`);
  process.exit(2);
}

// 2) 帖子列表:三种候选,谁先给出 tid 用谁
//    客户端 API 需要签名;移动 web 直连会撞百度安全验证;桌面页最老但通常还开着。
const listParams = {
  kw: forum,
  rn: '10',
  pn: '0',
  _client_type: '2',
  _client_version: '12.0.0',
};
listParams.sign = clientSign(listParams);
const listCandidates = [
  [
    '客户端 API 带签名',
    `https://c.tieba.baidu.com/c/f/frs/page?${new URLSearchParams(listParams)}`,
  ],
  ['桌面页', `https://tieba.baidu.com/f?kw=${encodeURIComponent(forum)}&ie=utf-8`],
  ['客户端 API 无签名', `https://c.tieba.baidu.com/c/f/frs/page?kw=${encodeURIComponent(forum)}&rn=10&pn=0`],
];
let tid = null;
for (const [label, url] of listCandidates) {
  const r = await call(`列表·${label}`, url, { cookie });
  tid = /\b(?:tid|thread_id)"?\s*[:=]\s*"?(\d{6,})/.exec(r.text)?.[1] ?? null;
  if (tid) {
    console.log(`  => 取到 tid=${tid}`);
    break;
  }
}

if (go) {
  // 3) 回帖:web 端表单式,失败再试客户端签名式
  const content = '+3';
  const webForm = {
    ie: 'utf-8',
    kw: forum,
    fid: String(info.forum_id),
    tid: tid ?? '0',
    content,
    tbs: String(tbs),
  };
  const r1 = await call('回帖·web /f/commit/post/add', 'https://tieba.baidu.com/f/commit/post/add', {
    cookie,
    form: webForm,
  });
  const webOk = /"no"\s*:\s*0/.test(r1.text) || /"error_code"\s*:\s*"?0"?/.test(r1.text);
  console.log(`  => web 回帖判定:${webOk ? '成功' : '未成功'}`);

  if (!webOk) {
    const clientParams = {
      kz: forum,
      tid: String(tid ?? '0'),
      content,
      tbs: String(tbs),
      _client_type: '2',
      _client_version: '12.0.0',
    };
    clientParams.sign = clientSign(clientParams);
    await call('回帖·客户端 /c/c/post/add', 'https://c.tieba.baidu.com/c/c/post/add', {
      cookie,
      form: clientParams,
      ua: CLIENT_UA,
    });
  }

  // 4) 点赞:两条候选
  if (tid) {
    await call('点赞·/f/commit/agree/opAgree', 'https://tieba.baidu.com/f/commit/agree/opAgree', {
      cookie,
      form: { obj_id: tid, obj_type: '3', tbs: String(tbs), ie: 'utf-8' },
    });
    await call('点赞·/dc/c/post/agree', 'https://tieba.baidu.com/dc/c/post/agree', {
      cookie,
      form: { post_id: tid, obj_type: '3', tbs: String(tbs) },
    });
  }

  // 5) 读回:经验变了多少
  const after = await fetch('https://tieba.baidu.com/mo/q/newmoindex', {
    headers: { 'User-Agent': UA, Referer: 'https://tieba.baidu.com/', Cookie: cookie },
    signal: AbortSignal.timeout(15000),
  }).then((r) => r.json());
  const now = (after?.data?.like_forum ?? []).find((f) => f.forum_name === forum);
  console.log(`\n读回:${forum} Lv${now?.user_level} exp=${now?.user_exp}(动作前 ${info.user_exp})`);
}

// 6) --replies N:同一个吧连发 N 条,每条之后读回经验,看单次增量与每日上限
async function readExp() {
  const j = await fetch('https://tieba.baidu.com/mo/q/newmoindex', {
    headers: { 'User-Agent': UA, Referer: 'https://tieba.baidu.com/', Cookie: cookie },
    signal: AbortSignal.timeout(15000),
  }).then((r) => r.json());
  const f = (j?.data?.like_forum ?? []).find((x) => x.forum_name === forum);
  return { exp: Number(f?.user_exp), level: f?.user_level };
}

if (replies > 0 && tid) {
  const base = await readExp();
  console.log(`
== 连发 ${replies} 条测经验 · 起点 exp=${base.exp}`);
  for (let i = 1; i <= replies; i++) {
    const r = await call(`第 ${i} 条`, 'https://tieba.baidu.com/f/commit/post/add', {
      cookie,
      form: { ie: 'utf-8', kw: forum, fid: String(info.forum_id), tid, content: '+3', tbs: String(tbs) },
    });
    const no = /"no"\s*:\s*(\d+)/.exec(r.text)?.[1];
    await new Promise((r2) => setTimeout(r2, 3000));
    const now = await readExp();
    console.log(`  第 ${i} 条 no=${no} · exp ${base.exp} -> ${now.exp}(第 ${i} 条累计 +${now.exp - base.exp})`);
  }
}

// 7) --like-scan:点赞端点扫描。路径猜错的会回 404 页面,能回 JSON 的才值得继续
if (likeScan && tid) {
  const candidates = [
    ['/c/c/agree/opAgree', 'https://c.tieba.baidu.com/c/c/agree/opAgree', true],
    ['/dc/c/agree/opAgree', 'https://tieba.baidu.com/dc/c/agree/opAgree', false],
    ['/f/commit/agree/opAgree', 'https://tieba.baidu.com/f/commit/agree/opAgree', false],
    ['/c/c/post/agree', 'https://c.tieba.baidu.com/c/c/post/agree', true],
    ['/f/commit/post/agree', 'https://tieba.baidu.com/f/commit/post/agree', false],
    ['/dc/c/post/agree', 'https://tieba.baidu.com/dc/c/post/agree', false],
  ];
  for (const [label, url, needSign] of candidates) {
    const form = { obj_id: tid, post_id: tid, obj_type: '3', agree_type: '3', tbs: String(tbs) };
    if (needSign) {
      Object.assign(form, { _client_type: '2', _client_version: '12.0.0' });
      form.sign = clientSign(form);
    }
    const r = await call(`点赞候选 ${label}`, url, { cookie, form, ...(needSign ? { ua: CLIENT_UA } : {}) });
    const isJson = r.text.trim().startsWith('{');
    console.log(`  => ${isJson ? '返回 JSON,记下来' : '不是 JSON(多半 404 页),跳过'}`);
    await new Promise((r2) => setTimeout(r2, 1500));
  }
}

// 8) --like-combo:点赞参数组合扫描。/c/c/agree/opAgree 会回 JSON,但 300000 说明参数不对,
//    用枚举把它试出来 —— 每种组合都读一次经验,顺便确认「点赞到底加不加经验」。
if (likeCombo && tid) {
  const before = await readExp();
  const combos = [];
  for (const objType of ['1', '3']) {
    for (const agreeType of ['1', '3']) {
      combos.push({ obj_id: tid, obj_type: objType, agree_type: agreeType });
      combos.push({ obj_id: tid, thread_id: tid, obj_type: objType, agree_type: agreeType });
    }
  }
  for (const c of combos) {
    const form = { ...c, tbs: String(tbs), _client_type: '2', _client_version: '12.0.0' };
    form.sign = clientSign(form);
    const r = await call(
      `combo ${JSON.stringify(c)}`,
      'https://c.tieba.baidu.com/c/c/agree/opAgree',
      { cookie, form, ua: CLIENT_UA }
    );
    const code = /"error_code"\s*:\s*"?(-?\d+)/.exec(r.text)?.[1];
    console.log(`  => error_code=${code}`);
    await new Promise((r2) => setTimeout(r2, 1500));
  }
  const after = await readExp();
  console.log(`
点赞前后经验:${before.exp} -> ${after.exp}(增 ${after.exp - before.exp})`);
}
