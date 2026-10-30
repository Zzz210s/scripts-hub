// 探针:找出各吧里的「水经验贴」。
//
// 要解决的问题:需求从「每个吧随便找帖子回 4 条」改成「回在专门的水楼里,没有水楼就不发」。
// 那就必须先知道:能不能发现水楼?靠置顶、靠搜索、还是只能翻页?
//
// 用法(容器内):
//   node /opt/tieba/tools/probe-water.mjs --forums 2ch,bilibili,c++
//
// 只读,不发任何请求以外的东西。

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CLIENT_UA = 'bdtb for Android 12.0.0';
const SALT = 'tiebaclient!!!';

// 水楼标题里常见的关键词。宁可漏也不能错:发错帖子比不发更糟。
const WATER_TITLE = /(水楼|水经验|经验\+?3|\+3|水贴|水帖|专用水|刷经验|经验专用|经验贴|签到水)/;

function sign(params) {
  const raw = Object.keys(params)
    .filter((key) => key !== 'sign')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('');
  return createHash('md5')
    .update(`${raw}${SALT}`)
    .digest('hex')
    .toUpperCase();
}

function args() {
  const argv = process.argv.slice(2);
  const out = { forums: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--forums') out.forums = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

function readEnv() {
  const text = readFileSync('/opt/tieba/.env', 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = readEnv();
const cookie = env.ACCOUNT_1_STOKEN
  ? `BDUSS=${env.ACCOUNT_1_BDUSS}; STOKEN=${env.ACCOUNT_1_STOKEN}`
  : `BDUSS=${env.ACCOUNT_1_BDUSS}`;

async function getJson(url, { client = false } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': client ? CLIENT_UA : UA, Referer: 'https://tieba.baidu.com/', Cookie: cookie },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, text };
  }
}

/** 客户端列表:返回前若干页的标题与置顶标记。 */
async function listThreads(kw, pages = 1) {
  const out = [];
  for (let pn = 0; pn < pages; pn++) {
    const params = { kw, rn: '30', pn: String(pn), _client_type: '2', _client_version: '12.0.0' };
    params.sign = sign(params);
    const { json } = await getJson(
      `https://c.tieba.baidu.com/c/f/frs/page?${new URLSearchParams(params)}`,
      { client: true }
    );
    for (const t of json?.thread_list ?? []) {
      out.push({
        page: pn + 1,
        tid: String(t.id ?? t.tid ?? ''),
        title: String(t.title ?? ''),
        isTop: Number(t.is_top) === 1,
        replyNum: Number(t.reply_num) || 0,
      });
    }
  }
  return out;
}

/** 搜索候选:web 搜索页(HTML)。返回命中的 tid 与标题。 */
async function searchWater(kw) {
  const url = `https://tieba.baidu.com/f/search/res?ie=utf-8&qw=${encodeURIComponent('水经验')}&kw=${encodeURIComponent(kw)}&rn=10&pn=0`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://tieba.baidu.com/', Cookie: cookie },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  const hits = [...text.matchAll(/href="\/p\/(\d{9,})"[^>]*>([^<]{2,60})</g)]
    .slice(0, 5)
    .map((m) => ({ tid: m[1], title: m[2].trim() }));
  return { status: res.status, length: text.length, hits, looksBlocked: /安全验证/.test(text) };
}

/** 客户端搜索候选:哪个能回 JSON 就记下来。 */
async function searchCandidates(kw, word) {
  const candidates = [
    ['/c/s/search/all', 'https://c.tieba.baidu.com/c/s/search/all'],
    ['/c/f/search/res', 'https://c.tieba.baidu.com/c/f/search/res'],
    ['/c/s/search/thread', 'https://c.tieba.baidu.com/c/s/search/thread'],
  ];
  for (const [label, base] of candidates) {
    const params = { word, kw, rn: '10', pn: '0', _client_type: '2', _client_version: '12.0.0' };
    params.sign = sign(params);
    const { status, json, text } = await getJson(`${base}?${new URLSearchParams(params)}`, { client: true });
    const ok = json ? `JSON error_code=${json.error_code ?? '?'}` : `非 JSON ${String(text ?? '').length} 字节`;
    console.log(`    ${label} -> HTTP ${status} · ${ok}`);
    if (json?.post_list?.length || json?.thread_list?.length) {
      const list = json.post_list ?? json.thread_list;
      for (const item of list.slice(0, 3)) {
        console.log(`      命中 tid=${item.tid ?? item.thread_id ?? '?'} · ${String(item.title ?? item.content ?? '').slice(0, 36)}`);
      }
      return true;
    }
  }
  return false;
}

const { forums } = args();
for (const kw of forums) {
  console.log(`\n=== ${kw}`);
  const threads = await listThreads(kw, 3);
  const top = threads.filter((t) => t.isTop);
  const named = threads.filter((t) => WATER_TITLE.test(t.title));
  console.log(`  列表 ${threads.length} 条 · 置顶 ${top.length} 条 · 标题像水楼 ${named.length} 条`);
  for (const t of top.slice(0, 6)) console.log(`    [置顶] ${t.replyNum} 回复 · ${t.title.slice(0, 40)} · tid=${t.tid}`);
  for (const t of named.slice(0, 8)) console.log(`    [像水楼 p${t.page}] ${t.replyNum} 回复 · ${t.title.slice(0, 40)} · tid=${t.tid}`);

  if (process.argv.includes('--search')) {
    const found = await searchCandidates(kw, '水经验');
    if (!found) console.log('    (客户端搜索没有可用结果)');
    const s = await searchWater(kw);
    console.log(`  搜索 HTTP ${s.status} · ${s.length} 字节 · 命中 ${s.hits.length} 条${s.looksBlocked ? ' · 撞安全验证' : ''}`);
  }
}
