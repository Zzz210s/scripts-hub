// 每日互动:按「这个吧还差多少经验」决定今天给它花几条回帖,再点一个赞。
//
// 为什么按经验排而不是一刀切:2026-10-30 真机实测,每吧每天回帖只会给 **4 点**经验
// (第 1~4 条各 +1,第 5 条起 +0),签到另算。所以一个 Lv5 只差 3 点的吧,发 4 条纯属浪费;
// 一个 Lv8 差 400 点的吧,发 4 条也只是杯水车薪 —— 数量由 `gap` 封顶,不做无意义重复。
//
// 点赞**不加经验**(实测前后 +0),它的意义是让这个账号在那个吧里有正常互动痕迹,
// 所以每吧一次、按留痕对待,不参与经验预算。

import { DEFAULTS, planForForum } from './interact-plan.js';
import { fetchThreads, likeThread, postReply } from './interact-api.js';

/** 这些错误说明「这个帖子没了」,换一个帖子继续就行,不该计入连续失败 —— 否则
 *  某个吧的头几个帖子恰好被删,整轮就会被误判成风控而停下(2026-10-30 就这么停过一次)。 */
const STALE_THREAD = /(帖子不存在|帖子已被删除|已被删除|已被关闭)/;
/** tbs 过期/被换掉时的两种文案:换一枚 tbs 重试一次,而不是把它当成账号被限。 */
const STALE_TBS = /(TBS|tbs|用户没有权限|权限校验)/;
/** 限流文案:点赞比回帖更容易撞上(实测连点二十来个就开始「您操作的太频繁了」)。
 *  它是「慢一点」而不是「这个号不能用」,所以退避后继续,并且不再把点赞算成失败。 */
const THROTTLED = /(太频繁|操作太快|稍后再试|请求过于频繁)/;

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
  // 一轮互动要跑三十多分钟。没有逐吧日志的话,中途卡住只能干瞪眼 —— 2026-10-30 就卡过一次。
  const say = typeof opts.log === 'function' ? opts.log : () => {};
  // tbs 会失效:2026-10-30 实测,拿会话里那枚 tbs 去发帖,几分钟后整套返回
  // 「用户没有权限 / TBS校验失败」。所以每进一个吧就换一枚新的,失败了再换一次重试。
  let tbsNow = tbs;
  const refresh = async () => {
    if (typeof opts.refreshTbs !== 'function') return false;
    try {
      const next = await opts.refreshTbs();
      if (next) {
        tbsNow = next;
        return true;
      }
    } catch {
      /* 换不到就沿用旧的 */
    }
    return false;
  };
  // 增量记账:只把「自上次提交以来」的条数交出去,避免同一个数被重复累加。
  const pending = {};
  const flush = async () => {
    if (typeof opts.onProgress !== 'function' || !Object.keys(pending).length) return;
    const counts = { ...pending };
    for (const key of Object.keys(pending)) delete pending[key];
    try {
      await opts.onProgress({ counts });
    } catch {
      /* 进度落盘失败不该打断正在跑的互动 */
    }
  };
  let forumsDone = 0;

  const paced = (options) =>
    options.jitter && options.intervalMs > 0
      ? Math.round(options.intervalMs * (0.7 + Math.random() * 0.6))
      : options.intervalMs;
  const stats = {
    posts: 0,
    likes: 0,
    likesThrottled: 0,
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

  let likeOff = false; // 点赞被限流到上限后,本轮不再点赞(回帖照常)
  let badForums = 0; // 连续「一个活都没干成的吧」数
  let forumFails = 0; // 当前这个吧已经失败几次
  const fail = (kw, error) => {
    stats.failures.push({ kw, error });
    say(`[互动] ${kw} 失败 · ${error}`);
    if (stats.failureSamples.length < 3) stats.failureSamples.push(`${kw}:${error}`);
    forumFails++;
    // 同一个吧连错两次就跳过他:换帖子继续,别把整轮当成账号被限。
    if (forumFails >= 2) return { skipForum: true, stopAll: false };
    if (STALE_THREAD.test(String(error))) return { skipForum: false, stopAll: false };
    return { skipForum: false, stopAll: false };
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
    // 单轮只处理若干个吧:剩下的留给下一次触发。一口气几百条会被判「发帖太快」。
    if (opts.maxForumsPerRun > 0 && forumsDone >= opts.maxForumsPerRun) {
      stats.stopReason = 'forum-budget';
      break;
    }
    // 一条回帖挂一个帖子,所以先取够帖子;取不到就整吧跳过,不硬发到列表之外。
    say(`[互动] ${forum.kw} Lv${forum.level} exp=${forum.exp} 差 ${plan.gap} → ${plan.replies} 条`);
    await refresh();
    const list = await api.fetchThreads({ kw: forum.kw, limit: Math.max(plan.replies, 1), cookie, deps });
    if (!list.ok) {
      fail(forum.kw, `列表:${list.error ?? list.reason}`);
      continue;
    }
    if (!list.tids.length) {
      fail(forum.kw, '列表:这个吧没有可回复的帖子');
      continue;
    }

    for (let index = 0; index < plan.replies && stats.posts < opts.maxPosts; index++) {
      const tid = list.tids[index];
      if (!tid) break;
      const post = () =>
        api.postReply({ kw: forum.kw, fid: forum.fid, tid, content: opts.content, tbs: tbsNow, cookie, deps });
      let result = await post();
      if (!result.ok && STALE_TBS.test(String(result.error)) && (await refresh())) result = await post();
      if (result.ok) {
        stats.posts++;
        stats.perForum[forum.kw] = (stats.perForum[forum.kw] ?? 0) + 1;
        pending[forum.kw] = (pending[forum.kw] ?? 0) + 1;
        if (result.risk) {
          stats.risk = result.risk;
          break;
        }
      } else if (result.risk) {
        stats.risk = result.risk;
        break;
      } else if (fail(forum.kw, `回帖:${result.error ?? result.reason}`).skipForum) break;
      if (opts.intervalMs > 0) await sleep(paced(opts));
    }
    if (stats.risk || stats.stopReason) break;
    // 结算这个吧:一条都没发成算一次「坏吧」,连续 badForums 个就整体收手。
    badForums = forumFails > 0 && (stats.perForum[forum.kw] ?? 0) === 0 ? badForums + 1 : 0;
    forumFails = 0;
    if (badForums >= opts.maxConsecutiveFailures) {
      stats.stopReason = 'too-many-failures';
      break;
    }
    // 每个吧收尾时按批提交进度
    forumsDone++;
    if (opts.progressEvery > 0 && forumsDone % opts.progressEvery === 0) await flush();

    // 点赞:每吧一个,挂在列表第一个帖子上。已经点过也算完成,不重复消耗预算。
    if (!likeOff && stats.likes + stats.alreadyLiked < opts.maxLikes) {
      const like = () => api.likeThread({ tid: list.tids[0], tbs: tbsNow, cookie, deps });
      let liked = await like();
      if (!liked.ok && STALE_TBS.test(String(liked.error)) && (await refresh())) liked = await like();
      if (liked.ok) {
        if (liked.already) stats.alreadyLiked++;
        else stats.likes++;
      } else if (liked.risk) {
        stats.risk = liked.risk;
        break;
      } else if (THROTTLED.test(String(liked.error))) {
        // 限流:这一轮剩下的点赞全部作废,回帖不受影响。
        stats.likesThrottled++;
        say(`[互动] 点赞被限流,本轮不再点赞 · ${liked.error}`);
        if (stats.likesThrottled >= opts.maxLikeThrottles) likeOff = true;
        else await sleep(opts.throttleBackoffMs);
      } else if (fail(forum.kw, `点赞:${liked.error ?? liked.reason}`).skipForum) break;
      if (opts.intervalMs > 0) await sleep(paced(opts));
    }
  }
  await flush();
  return stats;
}

// 计划层从这里转出去,调用方按老路径 import 也不会断。
export { DEFAULTS, planForForum, planInteract } from './interact-plan.js';
