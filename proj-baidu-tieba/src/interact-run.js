// 把互动接进编排:配置装配、逐账号调度、把结果摊平成消息行。
//
// 单独一个文件是因为它跨了三个模块(接口 / 计划 / 会话读回),塞回 run.js 会把编排
// 主干挤到 200 行以上;规则是自研文件不超 200 行,所以这里按职责再切一刀。

import { runInteract } from './interact.js';
import { recordInteract, writeState } from './state.js';
import { fetchSession, fetchTbs } from './client.js';
import { gapToNextLevel } from './exp.js';
import { SEP } from './message-text.js';

/**
 * 每日互动:签到与对账之后,按各吧「距下一级还差多少经验」发回帖 + 点赞。
 *
 * 只对**这轮签到成功拿到会话**的账号跑:拿不到列表就无从安排,硬发只会瞎猜。
 * 经验增量不在这里算 —— 由调用方在互动之后重读会话比对,这样数字是真值而不是累加出来的。
 */
/**
 * 造一个「互动进度落盘」回调:每处理几个吧就把当天已发条数写进状态。
 * 看门狗强杀容器时,已经发出去的帖子不会变成无账可查 —— 否则下一次触发会重复发。
 */
export function makeProgressFlush({ state, day, config, deps, now }) {
  return async ({ counts }) => {
    recordInteract(state, { day, counts });
    writeState(state, config.stateDir, now, { fsImpl: deps.fsImpl });
  };
}

export async function interactAll({ accounts, forumsAfter, credentials, config, deps, postedToday = {}, onProgress, log }) {
  const perAccount = {};
  for (const account of accounts) {
    const credential = credentials.find((item) => item.id === account.id);
    const session = forumsAfter[account.id];
    if (credential?.ok !== true || session?.ok !== true) {
      perAccount[account.id] = { ok: false, error: '这一轮没有可用的关注列表', stats: null };
      continue;
    }
    // 排序决定「今天先照顾谁」:还没发满的吧排前面,其次缺口大的排前面。
    // 这样三次触发天然把 136 个吧分摊掉,而不是每次都在前 45 个吧上打转。
    const forums = (session.forums ?? [])
      .filter((forum) => !config.filter || config.filter.includes(forum.kw))
      .sort(
        (a, b) =>
          (postedToday[a.kw] ?? 0) - (postedToday[b.kw] ?? 0) ||
          (gapToNextLevel(b.level, b.exp) ?? 0) - (gapToNextLevel(a.level, a.exp) ?? 0)
      );
    const stats = await runInteract({
      forums,
      tbs: credential.tbs,
      cookie: account.cookie,
      options: {
        onProgress: onProgress ? (payload) => onProgress({ ...payload, accountId: account.id }) : undefined,
        log,
        // 每进一个吧就换一枚 tbs:实测那枚会失效,继续用只会拿到「用户没有权限」。
        refreshTbs: async () => {
          const fresh = await fetchTbs({ cookie: account.cookie, deps });
          return fresh.ok ? fresh.tbs : null;
        },
        postedToday,
        perForum: config.interactPerForum,
        maxPosts: config.interactMaxPosts,
        maxLikes: config.interactMaxLikes,
        maxForumsPerRun: config.interactMaxForums,
        intervalMs: config.interactIntervalMs,
        content: config.interactContent
      },
      deps
    });
    // 增量只能在同一批吧上比:拿「全部关注吧的总经验」减「本轮处理的那几个吧」必然虚高。
    const after = await fetchSession({ cookie: account.cookie, deps });
    const keys = new Set(forums.map((forum) => forum.kw));
    const expAfter = (after.ok ? after.forums ?? [] : [])
      .filter((forum) => keys.has(forum.kw))
      .reduce((sum, forum) => {
        const value = Number(forum.exp);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0);
    perAccount[account.id] = {
      ok: after.ok === true,
      error: after.ok ? null : after.error,
      stats,
      expAfter: after.ok ? expAfter : null,
      expGained: after.ok ? expAfter - stats.expBefore : null
    };
  }
  return perAccount;
}

/** 把互动结果按账号 id 摊平成消息层要的行。没有结果就返回空数组。 */
export function interactLines(perAccount = {}) {
  const lines = [];
  for (const [id, entry] of Object.entries(perAccount)) {
    const stats = entry?.stats;
    if (!stats) {
      lines.push(`互动${SEP}${id}${SEP}未执行${SEP}${entry?.error ?? '没有可用列表'}`);
      continue;
    }
    const parts = [`回帖 ${stats.posts}`, `点赞 ${stats.likes + stats.alreadyLiked}`];
    // 经验增量在 entry 上(由互动之后重读会话算出来),不在 stats 里 —— 它是真值不是累加。
    const gained = Number.isFinite(entry?.expGained) ? entry.expGained : null;
    if (gained !== null) parts.push(`经验 +${gained}`);
    if (stats.skipped) parts.push(`跳过 ${stats.skipped}`);
    if (stats.failures.length) parts.push(`失败 ${stats.failures.length}`);
    if (stats.risk) parts.push(`风控中途停下:${stats.risk}`);
    lines.push(`互动${SEP}${parts.join(SEP)}`);
  }
  return lines;
}


/** dry 预览用的一行:互动有副作用,预览就该看得见规模,但此时不联网只报配置口径。 */
export function interactPreview(config) {
  return `[互动] 每吧最多 ${config.interactPerForum} 条回帖 · 全局上限 ${config.interactMaxPosts} 条 / ${config.interactMaxLikes} 个赞 · 内容 ${config.interactContent}`;
}

/** 历史里只留渲染与复盘需要的字段,不把逐吧明细整份写进去。 */
export function interactHistory(interact = {}) {
  return Object.fromEntries(
    Object.entries(interact).map(([id, entry]) => [
      id,
      entry?.stats
        ? {
            posts: entry.stats.posts,
            likes: entry.stats.likes,
            expGained: entry.expGained,
            risk: entry.stats.risk,
            failures: entry.stats.failures.length
          }
        : { error: entry?.error ?? null }
    ])
  );
}

/** 失败原文抽样:消息里只报条数,日志里要能看见到底哪一步崩的。 */
export function interactFailureSamples(interact = {}) {
  return Object.values(interact).flatMap((entry) => entry?.stats?.failureSamples ?? []);
}
