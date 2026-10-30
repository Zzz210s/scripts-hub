// 互动计划的回归:条数由「距下一级差多少经验」封顶,读不到经验就跳过而不是发满。
//
// 这条规则来自真机实测:每吧每天只给 4 点经验(第 5 条起 +0)。发超过缺口的条数是白担风控。

import assert from 'node:assert/strict';
import test from 'node:test';

import { planForForum, planInteract, runInteract, DEFAULTS } from '../src/interact.js';

test('缺口小于每吧上限时,只发缺口那么多条', () => {
    // Lv5 差 3 点到 Lv6(门槛 100,当前 97)
    assert.deepEqual(planForForum({ kw: 'a', level: 5, exp: 97 }), { replies: 3, gap: 3, reason: 'ok' });
});

test('缺口大于上限时封顶到 4 条', () => {
    // Lv8 差 417 点(门槛 1000,当前 583)
    assert.deepEqual(planForForum({ kw: 'b', level: 8, exp: 583 }), { replies: 4, gap: 417, reason: 'ok' });
});

test('经验读不到就跳过,绝不当成 0 或发满', () => {
    assert.deepEqual(planForForum({ kw: 'c', level: 8, exp: null }), { replies: 0, gap: null, reason: 'unknown-exp' });
    assert.deepEqual(planForForum({ kw: 'd' }), { replies: 0, gap: null, reason: 'unknown-exp' });
});

test('已满级或缺口为 0 时不发', () => {
    assert.deepEqual(planForForum({ kw: 'e', level: 20, exp: 1000001 }), { replies: 0, gap: 0, reason: 'max-level' });
    assert.deepEqual(planForForum({ kw: 'f', level: 8, exp: 1000 }), { replies: 0, gap: 0, reason: 'max-level' });
});

test('perForum 可调,0 表示不发', () => {
    assert.equal(planForForum({ kw: 'g', level: 8, exp: 583 }, { perForum: 2 }).replies, 2);
    assert.equal(planForForum({ kw: 'h', level: 8, exp: 583 }, { perForum: 0 }).replies, 0);
});

test('整轮计划给出总量,并跳过没有吧名的条目', () => {
    const { plans, totalReplies } = planInteract([
        { kw: 'a', level: 5, exp: 97 },
        { kw: 'b', level: 8, exp: 583 },
        { kw: null, level: 8, exp: 583 },
    ]);
    assert.equal(plans.length, 2);
    assert.equal(totalReplies, 7);
});

/** 造一个假接口,记录每次调用,让用例能断言「发了几条、发给哪个吧」。 */
function fakeApi(overrides = {}) {
    const calls = { threads: [], replies: [], likes: [] };
    const api = {
        fetchThreads: async ({ kw }) => {
            calls.threads.push(kw);
            return { ok: true, tids: [`${kw}-1`, `${kw}-2`, `${kw}-3`, `${kw}-4`, `${kw}-5`], reason: 'ok' };
        },
        postReply: async ({ kw, tid }) => {
            calls.replies.push({ kw, tid });
            return { ok: true, error: null, reason: 'ok', risk: null };
        },
        likeThread: async ({ tid }) => {
            calls.likes.push(tid);
            return { ok: true, already: false, error: null, reason: 'ok', risk: null };
        },
        ...overrides
    };
    return { api, calls };
}

const noSleep = async () => {};

test('一轮跑完:按计划发帖、每吧点一个赞,间隔等待可注入', async () => {
    const { api, calls } = fakeApi();
    const stats = await runInteract({
        forums: [
            { kw: 'a', fid: 1, level: 5, exp: 97 },
            { kw: 'b', fid: 2, level: 8, exp: 583 },
        ],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.posts, 7); // 3 + 4
    assert.equal(stats.likes, 2);
    assert.equal(stats.failures.length, 0);
    assert.equal(calls.replies.filter((one) => one.kw === 'a').length, 3);
    assert.deepEqual(calls.likes, ['a-1', 'b-1']);
});

test('风控一出现就整体收手,不再发下一个吧', async () => {
    const { api, calls } = fakeApi({
        postReply: async ({ kw, tid }) => {
            calls.replies.push({ kw, tid });
            return kw === 'a'
                ? { ok: true, error: null, reason: 'ok', risk: '需要验证码' }
                : { ok: true, error: null, reason: 'ok', risk: null };
        }
    });
    const stats = await runInteract({
        forums: [
            { kw: 'a', fid: 1, level: 8, exp: 583 },
            { kw: 'b', fid: 2, level: 8, exp: 583 },
        ],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.risk, '需要验证码');
    assert.equal(stats.posts, 1);
    assert.deepEqual(calls.threads, ['a']); // 第二个吧根本没去拉列表
});

test('连续失败达到阈值就停,不把整轮拖成几千次请求', async () => {
    const { api } = fakeApi({
        postReply: async () => ({ ok: false, error: '接口返回 no=1', reason: 'rejected', risk: null })
    });
    const stats = await runInteract({
        forums: Array.from({ length: 10 }, (_, i) => ({ kw: `f${i}`, fid: i, level: 8, exp: 583 })),
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        options: { maxConsecutiveFailures: 2 },
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.posts, 0);
    assert.equal(stats.stopReason, 'too-many-failures');
    assert.ok(stats.failures.length >= 2);
});

test('已经点过赞算完成,不再占点赞预算', async () => {
    const { api } = fakeApi({
        likeThread: async () => ({ ok: true, already: true, error: null, reason: 'ok', risk: null })
    });
    const stats = await runInteract({
        forums: [{ kw: 'a', fid: 1, level: 5, exp: 97 }],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.likes, 0);
    assert.equal(stats.alreadyLiked, 1);
});

test('列表拿不到就跳过这个吧,不当成发帖失败刷屏', async () => {
    const { api } = fakeApi({
        fetchThreads: async () => ({ ok: false, tids: [], error: '超时', reason: 'network' })
    });
    const stats = await runInteract({
        forums: [{ kw: 'a', fid: 1, level: 8, exp: 583 }],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.posts, 0);
    assert.equal(stats.failures.length, 1);
    assert.match(stats.failures[0].error, /列表/);
});

test('全局回帖预算封顶:超过就不再发', async () => {
    const { api } = fakeApi();
    const stats = await runInteract({
        forums: Array.from({ length: 3 }, (_, i) => ({ kw: `f${i}`, fid: i, level: 8, exp: 583 })),
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        options: { maxPosts: 5, intervalMs: 0 },
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.posts, 5);
    assert.equal(stats.stopReason, 'post-budget');
});

test('默认参数就是实测出来的那几个数', () => {
    assert.equal(DEFAULTS.perForum, 4);
    assert.equal(DEFAULTS.content, '+3');
    assert.equal(DEFAULTS.maxConsecutiveFailures, 3);
});

test('今天已经发过的条数要从预算里扣掉 —— 一天三次触发不该把同一个吧刷到 12 条', async () => {
    const { api, calls } = fakeApi();
    const stats = await runInteract({
        forums: [{ kw: 'a', fid: 1, level: 8, exp: 583 }],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        options: { perForum: 4, postedToday: { a: 3 } },
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.posts, 1);
    assert.equal(calls.replies.length, 1);

    // 已经发满 4 条的,再触发就直接跳过,一次请求都不发
    const full = await runInteract({
        forums: [{ kw: 'a', fid: 1, level: 8, exp: 583 }],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        options: { perForum: 4, postedToday: { a: 4 } },
        deps: { api, sleep: noSleep }
    });
    assert.equal(full.posts, 0);
    assert.equal(calls.replies.length, 1);
});

test('逐吧条数会被回报,供状态层累加', async () => {
    const { api } = fakeApi();
    const stats = await runInteract({
        forums: [
            { kw: 'a', fid: 1, level: 5, exp: 97 },
            { kw: 'b', fid: 2, level: 8, exp: 583 },
        ],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        deps: { api, sleep: noSleep }
    });
    assert.deepEqual(stats.perForum, { a: 3, b: 4 });
});

test('帖子被删不算风控:换个帖子继续,连续失败计数要退回去', async () => {
    let n = 0;
    const { api } = fakeApi({
        postReply: async () => {
            n++;
            // 前两条是「帖子不存在」,第三条正常成功
            return n <= 2
                ? { ok: false, error: '帖子已被删除', reason: 'rejected', risk: null }
                : { ok: true, error: null, reason: 'ok', risk: null };
        }
    });
    const stats = await runInteract({
        forums: [{ kw: 'a', fid: 1, level: 8, exp: 583 }],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        options: { maxConsecutiveFailures: 3 },
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.risk, null);
    assert.equal(stats.stopReason, null);
    assert.equal(stats.posts, 2); // 4 条计划里,前两条换帖子后成功
    assert.equal(stats.failures.length, 2);
});

test('失败样本最多留三条,留着给日志定位', async () => {
    const { api } = fakeApi({
        postReply: async () => ({ ok: false, error: '接口返回 no=7', reason: 'rejected', risk: null })
    });
    const stats = await runInteract({
        forums: [{ kw: 'a', fid: 1, level: 8, exp: 583 }],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        options: { maxConsecutiveFailures: 3 },
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.failureSamples.length, 3);
    assert.match(stats.failureSamples[0], /^a:/);
});
