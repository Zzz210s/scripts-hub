// 手工跑一次互动(只动指定的几个吧),用于验证或补一天。
//
// 正常路径不需要它 —— 每个触发会跟着签到一起跑。它的价值在于:改完接口想小规模试水时,
// 不必为了 4 条回帖去跑一整轮 136 个吧。
//
// 用法(容器内):
//   node /opt/tieba/manual.mjs --forums 2ch,asoul --posts 4 --likes 2 [--dry]
//
// 只读 .env 里的 ACCOUNT_1_*,不碰状态文件,不发企业微信。

import { readFileSync } from 'node:fs';

import { fetchSession } from '/opt/tieba/src/client.js';
import { gapToNextLevel } from '/opt/tieba/src/exp.js';
import { planForForum, runInteract } from '/opt/tieba/src/interact.js';

function args() {
  const out = { forums: [], posts: 4, likes: 2, dry: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--forums') out.forums = String(argv[++i] ?? '').split(',').map((one) => one.trim()).filter(Boolean);
    else if (argv[i] === '--posts') out.posts = Number(argv[++i]);
    else if (argv[i] === '--likes') out.likes = Number(argv[++i]);
    else if (argv[i] === '--dry') out.dry = true;
  }
  return out;
}

function readEnv() {
  const out = {};
  for (const line of readFileSync('/opt/tieba/.env', 'utf8').split(/\r?\n/)) {
    const matched = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (matched) out[matched[1]] = matched[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const { forums: wanted, posts, likes, dry } = args();
const env = readEnv();
const cookie = env.ACCOUNT_1_STOKEN
  ? `BDUSS=${env.ACCOUNT_1_BDUSS}; STOKEN=${env.ACCOUNT_1_STOKEN}`
  : `BDUSS=${env.ACCOUNT_1_BDUSS}`;

const session = await fetchSession({ cookie });
if (!session.ok) {
  console.error(`取会话失败:${session.reason} ${session.error ?? ''}`);
  process.exit(1);
}
const all = session.forums ?? [];
const picked = wanted.length ? all.filter((forum) => wanted.includes(forum.kw)) : all.slice(0, 2);
console.log(`账号 uid=${session.uid} · 关注 ${all.length} 个吧 · 本轮处理 ${picked.length} 个`);
for (const forum of picked) {
  const plan = planForForum(forum);
  console.log(`  ${forum.kw} Lv${forum.level} exp=${forum.exp} 差 ${gapToNextLevel(forum.level, forum.exp)} → 计划 ${plan.replies} 条`);
}
if (dry) {
  console.log('(dry:只看计划,不发)');
  process.exit(0);
}

const before = picked.reduce((sum, forum) => sum + (Number(forum.exp) || 0), 0);
const stats = await runInteract({
  forums: picked,
  tbs: session.tbs,
  cookie,
  options: { perForum: posts, maxPosts: posts, maxLikes: likes, intervalMs: 3000, content: '+3' }
});
const after = await fetchSession({ cookie });
// 只比本轮处理过的吧:全量求和会把别的吧的经验算进来,增量会虚高到几万。
const pickedKeys = new Set(picked.map((forum) => forum.kw));
const afterExp = (after.forums ?? [])
  .filter((forum) => pickedKeys.has(forum.kw))
  .reduce((sum, forum) => sum + (Number(forum.exp) || 0), 0);
console.log(
  JSON.stringify(
    { posts: stats.posts, likes: stats.likes, alreadyLiked: stats.alreadyLiked, failures: stats.failures, risk: stats.risk, expBefore: before, expAfter: afterExp, expGained: afterExp - before },
    null,
    2
  )
);
