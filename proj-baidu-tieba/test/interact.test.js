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
    const calls = { waters: [], replies: [], likes: [] };
    const api = {
        // 找水楼:默认每个吧都有一个,回复数过千(真实水楼的量级)
        findWaterThread: async ({ kw }) => {
            calls.waters.push(kw);
            return { ok: true, tid: `${kw}-water`, title: `${kw} 水经验专用贴`, replies: 12000, reason: 'ok' };
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
    // 四条都发在同一个水楼里,不再到处挑帖子
    assert.deepEqual([...new Set(calls.replies.map((one) => one.tid))], ['a-water', 'b-water']);
    assert.deepEqual(calls.likes, ['a-water', 'b-water']);
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
    assert.deepEqual(calls.waters, ['a']); // 第二个吧根本没去找水楼
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

test('找水楼的请求失败就跳过这个吧,不当成发帖失败刷屏', async () => {
    const { api } = fakeApi({
        findWaterThread: async () => ({ ok: false, tid: null, error: '超时', reason: 'network' })
    });
    const stats = await runInteract({
        forums: [{ kw: 'a', fid: 1, level: 8, exp: 583 }],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.posts, 0);
    assert.equal(stats.failures.length, 1);
    assert.match(stats.failures[0].error, /找水楼/);
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

test('一个吧连错两次就跳过它,但整轮不因此停下', async () => {
    const { api, calls } = fakeApi({
        postReply: async ({ kw, tid }) => {
            calls.replies.push({ kw, tid });
            return kw === 'bad'
                ? { ok: false, error: '帖子已被删除', reason: 'rejected', risk: null }
                : { ok: true, error: null, reason: 'ok', risk: null };
        }
    });
    const stats = await runInteract({
        forums: [
            { kw: 'bad', fid: 1, level: 8, exp: 583 },
            { kw: 'good', fid: 2, level: 5, exp: 97 },
        ],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.stopReason, null);
    assert.equal(stats.perForum.bad, undefined); // 两次都失败,这个吧被跳过
    assert.equal(calls.replies.filter((one) => one.kw === 'bad').length, 2);
    assert.equal(stats.perForum.good, 3); // 下一个吧照常跑完
});

test('连续三个吧一个活都没干成才整体收手', async () => {
    const { api } = fakeApi({
        postReply: async () => ({ ok: false, error: '接口返回 no=271', reason: 'rejected', risk: null })
    });
    const stats = await runInteract({
        forums: Array.from({ length: 10 }, (_, i) => ({ kw: `f${i}`, fid: i, level: 8, exp: 583 })),
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        options: { maxConsecutiveFailures: 3 },
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.stopReason, 'too-many-failures');
    assert.equal(stats.posts, 0);
    // 每个坏吧只试两次就放弃,不会把一个吧刷成十几次请求
    for (const kw of ['f0', 'f1', 'f2']) {
        assert.equal(stats.failures.filter((one) => one.kw === kw).length, 2);
    }
});

test('单轮吧数上限生效:剩下的留给下一次触发', async () => {
    const { api, calls } = fakeApi();
    const stats = await runInteract({
        forums: Array.from({ length: 10 }, (_, i) => ({ kw: `f${i}`, fid: i, level: 5, exp: 97 })),
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        options: { maxForumsPerRun: 3 },
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.stopReason, 'forum-budget');
    assert.equal(calls.waters.length, 3);
});

test('失败样本最多留三条,留着给日志定位', async () => {
    const { api } = fakeApi({
        postReply: async () => ({ ok: false, error: '接口返回 no=7', reason: 'rejected', risk: null })
    });
    const stats = await runInteract({
        forums: Array.from({ length: 4 }, (_, i) => ({ kw: `f${i}`, fid: i, level: 8, exp: 583 })),
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.failureSamples.length, 3);
    assert.match(stats.failureSamples[0], /^f0:/);
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

test('找水楼的请求失败就跳过这个吧,不当成发帖失败刷屏', async () => {
    const { api } = fakeApi({
        findWaterThread: async () => ({ ok: false, tid: null, error: '超时', reason: 'network' })
    });
    const stats = await runInteract({
        forums: [{ kw: 'a', fid: 1, level: 8, exp: 583 }],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.posts, 0);
    assert.equal(stats.failures.length, 1);
    assert.match(stats.failures[0].error, /找水楼/);
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

test('点赞被限流不算失败:退避后继续,连续两次就停掉点赞,回帖照跑', async () => {
    let likeCalls = 0;
    const { api } = fakeApi({
        likeThread: async () => {
            likeCalls++;
            return { ok: false, already: false, error: '您操作的太频繁了', reason: 'rejected', risk: null };
        }
    });
    const stats = await runInteract({
        forums: Array.from({ length: 4 }, (_, i) => ({ kw: `f${i}`, fid: i, level: 5, exp: 97 })),
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        options: { throttleBackoffMs: 0 },
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.failures.length, 0); // 限流不进失败清单
    assert.equal(stats.likesThrottled, 2); // 到 2 次就停
    assert.equal(likeCalls, 2);
    assert.equal(stats.posts, 12); // 回帖全跑完
});

test('没有水楼的吧一条都不发,只记一笔', async () => {
    const { api, calls } = fakeApi({
        findWaterThread: async ({ kw }) => ({ ok: true, tid: null, title: null, replies: 0, reason: 'ok' })
    });
    const stats = await runInteract({
        forums: [{ kw: 'a', fid: 1, level: 8, exp: 583 }],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        deps: { api, sleep: noSleep }
    });
    assert.equal(stats.noWater, 1);
    assert.equal(stats.posts, 0);
    assert.equal(stats.likes, 0);
    assert.equal(calls.replies.length, 0);
    assert.equal(stats.failures.length, 0); // 没水楼不是失败
});

test('今天已经定位过的水楼不再重复翻列表,直接复用', async () => {
    const { api, calls } = fakeApi();
    const saved = {};
    await runInteract({
        forums: [
            { kw: 'a', fid: 1, level: 5, exp: 97 },
            { kw: 'b', fid: 2, level: 5, exp: 97 },
        ],
        tbs: 'tbs',
        cookie: 'BDUSS=x',
        options: {
            // a 已有缓存,b 是空串(今天确认过没有水楼)
            waterToday: { a: 'a-water', b: '' },
            saveWater: async (kw, tid) => {
                saved[kw] = tid;
            },
        },
        deps: { api, sleep: noSleep }
    });
    assert.deepEqual(calls.waters, []); // 一次列表都没翻
    assert.equal(saved.b, undefined);
});
