// 每日互动:按「这个吧还差多少经验」决定今天给它花几条回帖,再点一个赞。
//
// 为什么按经验排而不是一刀切:2026-10-30 真机实测,每吧每天回帖只会给 **4 点**经验
// (第 1~4 条各 +1,第 5 条起 +0),签到另算。所以一个 Lv5 只差 3 点的吧,发 4 条纯属浪费;
// 一个 Lv8 差 400 点的吧,发 4 条也只是杯水车薪 —— 数量由 `gap` 封顶,不做无意义重复。
//
// 点赞**不加经验**(实测前后 +0),它的意义是让这个账号在那个吧里有正常互动痕迹,
// 所以每吧一次、按留痕对待,不参与经验预算。

import { gapToNextLevel } from './exp.js';
import { fetchThreads, likeThread, postReply } from './interact-api.js';

/** 这些错误说明「这个帖子没了」,换一个帖子继续就行,不该计入连续失败 —— 否则
 *  某个吧的头几个帖子恰好被删,整轮就会被误判成风控而停下(2026-10-30 就这么停过一次)。 */
const STALE_THREAD = /(帖子不存在|帖子已被删除|已被删除|不存在|已被关闭|没有权限)/;

export const DEFAULTS = Object.freeze({
  perForum: 4,
  maxPosts: 544,
  maxLikes: 136,
  intervalMs: 3000,
  maxConsecutiveFailures: 3,
  // 间隔抖动:[0.7, 1.3] 倍。整点整秒地发几百条是机器人特征,抖动让节奏更像人。
  jitter: true,
  content: '+3'
});

/**
 * 单吧计划:`replies` 是本轮给它发的条数。
 * 经验读不到就跳过 —— 不猜、不默认发满 —— 这类吧单独计一个 `unknown-exp`。
 */
export function planForForum(forum, { perForum = DEFAULTS.perForum } = {}) {
  const gap = gapToNextLevel(forum?.level, forum?.exp);
  if (gap === null) return { replies: 0, reason: 'unknown-exp', gap: null };
  if (gap === 0) return { replies: 0, reason: 'max-level', gap: 0 };
  const capped = Math.min(gap, Math.max(0, perForum));
  return { replies: capped, reason: capped > 0 ? 'ok' : 'capped', gap };
}

/** 整轮计划:逐吧条数 + 总量。纯函数,便于先看清「今天要发多少条」再决定跑不跑。 */
export function planInteract(forums = [], options = {}) {
  const plans = [];
  let totalReplies = 0;
  for (const forum of Array.isArray(forums) ? forums : []) {
    if (!forum?.kw) continue;
    const plan = planForForum(forum, options);
    plans.push({ kw: forum.kw, ...plan });
    totalReplies += plan.replies;
  }
  return { plans, totalReplies };
}

const sumExp = (forums) =>
  (Array.isArray(forums) ? forums : []).reduce((sum, forum) => {
    const value = Number(forum?.exp);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

/**
 * 跑一轮互动。永不抛:任何一步失败都进 `failures`,风控一出现就整体收手。
 *
 * `deps` 里可注入 `sleep` / `api`(测试用),默认走真实接口与真实等待。
 */
export async function runInteract({ forums = [], tbs, cookie, options = {}, deps = {} } = {}) {
  const opts = { ...DEFAULTS, ...options };
  const api = deps.api ?? { fetchThreads, likeThread, postReply };
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const paced = (options) =>
    options.jitter && options.intervalMs > 0
      ? Math.round(options.intervalMs * (0.7 + Math.random() * 0.6))
      : options.intervalMs;
  const stats = {
    posts: 0,
    likes: 0,
    alreadyLiked: 0,
    skipped: 0,
    unknownExp: 0,
    failures: [],
    // 前几条失败原文:消息里只报条数,日志里要能看见到底哪一步崩的。
    failureSamples: [],
    risk: null,
    stopReason: null,
    perForum: {},
    expBefore: sumExp(forums)
  };

  let consecutive = 0;
  const fail = (kw, error) => {
    stats.failures.push({ kw, error });
    if (stats.failureSamples.length < 3) stats.failureSamples.push(`${kw}:${error}`);
    // 帖子没了 != 我被限流:前者换个帖子就好,不该把整轮打死。
    if (STALE_THREAD.test(String(error))) {
      consecutive = Math.max(0, consecutive - 1);
      return false;
    }
    consecutive++;
    return consecutive >= opts.maxConsecutiveFailures;
  };

  for (const forum of forums) {
    if (stats.risk || stats.stopReason) break;
    // 今天已经给这个吧发过几条 —— 扣掉它再算计划,否则一天三次触发会把同一吧刷到 12 条。
    const spent = Number(opts.postedToday?.[forum.kw] ?? 0) || 0;
    const plan = planForForum(forum, { perForum: Math.max(0, opts.perForum - spent) });
    if (plan.replies === 0) {
      stats.skipped++;
      if (plan.reason === 'unknown-exp') stats.unknownExp++;
      continue;
    }
    if (stats.posts >= opts.maxPosts) {
      stats.stopReason = 'post-budget';
      break;
    }
    // 一条回帖挂一个帖子,所以先取够帖子;取不到就整吧跳过,不硬发到列表之外。
    const list = await api.fetchThreads({ kw: forum.kw, limit: Math.max(plan.replies, 1), cookie, deps });
    if (!list.ok) {
      if (fail(forum.kw, `列表:${list.error ?? list.reason}`)) stats.stopReason = 'too-many-failures';
      continue;
    }
    if (!list.tids.length) {
      if (fail(forum.kw, '列表:这个吧没有可回复的帖子')) stats.stopReason = 'too-many-failures';
      continue;
    }

    for (let index = 0; index < plan.replies && stats.posts < opts.maxPosts; index++) {
      const tid = list.tids[index];
      if (!tid) break;
      const result = await api.postReply({
        kw: forum.kw,
        fid: forum.fid,
        tid,
        content: opts.content,
        tbs,
        cookie,
        deps
      });
      if (result.ok) {
        stats.posts++;
        stats.perForum[forum.kw] = (stats.perForum[forum.kw] ?? 0) + 1;
        consecutive = 0;
        if (result.risk) {
          stats.risk = result.risk;
          break;
        }
      } else if (result.risk) {
        stats.risk = result.risk;
        break;
      } else if (fail(forum.kw, `回帖:${result.error ?? result.reason}`)) {
        stats.stopReason = 'too-many-failures';
        break;
      }
      if (opts.intervalMs > 0) await sleep(paced(opts));
    }
    if (stats.risk || stats.stopReason) break;

    // 点赞:每吧一个,挂在列表第一个帖子上。已经点过也算完成,不重复消耗预算。
    if (stats.likes + stats.alreadyLiked < opts.maxLikes) {
      const liked = await api.likeThread({ tid: list.tids[0], tbs, cookie, deps });
      if (liked.ok) {
        if (liked.already) stats.alreadyLiked++;
        else stats.likes++;
        consecutive = 0;
      } else if (liked.risk) {
        stats.risk = liked.risk;
        break;
      } else if (fail(forum.kw, `点赞:${liked.error ?? liked.reason}`)) {
        stats.stopReason = 'too-many-failures';
        break;
      }
      if (opts.intervalMs > 0) await sleep(paced(opts));
    }
  }
  return stats;
}
