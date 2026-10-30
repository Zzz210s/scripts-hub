// 互动计划:每吧发几条、总量多少。纯函数,不碰网络 —— 便于先看清「今天要发多少条」。
//
// 为什么按经验排而不是一刀切:2026-10-30 真机实测,每吧每天回帖只会给 4 点经验
// (第 1~4 条各 +1,第 5 条起 +0),签到另算。所以 Lv5 只差 3 点的吧发 4 条纯属浪费;
// Lv8 差 400 点的吧发 4 条也只是杯水车薪 —— 数量由缺口封顶,不做无意义重复。

import { gapToNextLevel } from './exp.js';

export const DEFAULTS = Object.freeze({
  perForum: 4,
  maxPosts: 544,
  maxLikes: 136,
  intervalMs: 3000,
  maxConsecutiveFailures: 3,
  // 每处理完这么多个吧,就把「已发条数」推给回调一次。
  // 需要它是因为看门狗会强杀容器:发出去的帖子留在贴吧,记账却没落盘,下一次触发就重复发。
  progressEvery: 5,
  // 间隔抖动:[0.7, 1.3] 倍。整点整秒地发几百条是机器人特征,抖动让节奏更像人。
  jitter: true,
  // 单轮处理多少个吧:一天 3 次触发分摊,一口气发几百条会被判「发帖太快」(no=271 / 8009)。
  maxForumsPerRun: 45,
  // 点赞被限流的次数上限:到 2 次就整体停掉点赞,回帖继续。
  maxLikeThrottles: 2,
  // 限流后的退避时长。实测连点二十来个赞就会撞上「您操作的太频繁了」。
  throttleBackoffMs: 20000,
  // 找水楼时翻几页列表。实测 20 个吧里约 1/5 有水楼,3 页(90 条)能覆盖到老水楼。
  waterPages: 3,
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

