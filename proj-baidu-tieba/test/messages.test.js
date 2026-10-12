// Task 8 主体用例:四类消息的内容。重点:
//   1. 数字必须来自入参的接口数据(破坏性用例:传入与「计划口径」不同的数);
//   2. 对账 ok:null 必须渲染成「未能核对」,不许当成通过;ok:false 要说清为什么;
//   3. 逐账号一行、顺序按传入、屏蔽吧如实列出但与失败分开。
// 全局硬规则(不用圆括号 / 不用 emoji / 未知码兜底 / 长度护栏 / 原因词表)见 messages-rules.test.js。
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAction, buildResult, buildSkip, buildStart } from '../src/messages.js';
import { account, ctx, entry, reconcile } from './messages-helpers.js';

const actionWord = (text) => text.split('\n')[0].split(' · ').pop();

test('buildResult:标题四段式,逐账号一行,对账通过', () => {
  const text = buildResult(ctx());
  assert.equal(text.split('\n')[0], '百度贴吧签到 · alice · 2026-10-11 · 运行成功');
  assert.ok(text.includes('账号 alice · 已签 12 · 已签过 3 · 不可签 1 · tbs 失效 0 · 失败 0 · 对账 通过'));
  assert.ok(text.includes('对账:通过'));
});

test('buildResult:数字全部来自入参,不按计划口径推算', () => {
  const text = buildResult(ctx({
    accounts: [account('alice', { signed: 7, already: 999, blocked: 2, failed: 5 })],
    reconcile: reconcile({ ok: false, reason: 'missing', reasons: ['missing'], missingTotal: 3, blockedTotal: 42 }),
  }));
  for (const needle of ['已签 7', '已签过 999', '失败 5', '未签 3', '不可签 42']) {
    assert.ok(text.includes(needle), needle);
  }
  assert.ok(!text.includes('已签 12'));
  assert.ok(!text.includes('未签 0'));
});

test('buildResult:对账 ok:null 渲染成未能核对,不许当成通过', () => {
  const text = buildResult(ctx({ reconcile: reconcile({ ok: null, reason: 'list-failed', reasons: ['list-failed'] }) }));
  assert.ok(text.includes('未能核对'));
  assert.ok(text.includes('关注列表没取到'));
  assert.ok(!text.includes('对账:通过'));
  assert.equal(actionWord(text), '运行有失败');
});

test('buildResult:对账未通过时说明为什么,reasons 数组逐个体现', () => {
  const text = buildResult(ctx({
    reconcile: reconcile({
      ok: false,
      reason: 'truncated',
      reasons: ['truncated', 'empty-forums', 'missing', 'list-failed'],
      missingTotal: 2,
      truncated: true,
      emptyForums: true,
      unresolvedAccounts: ['bob'],
    }),
  }));
  assert.ok(text.includes('对账:未通过'));
  for (const why of ['被截断', '列表为空', '没签上', '没取到']) assert.ok(text.includes(why), why);
  assert.ok(text.includes('未能核对:bob'));
  assert.ok(text.includes('后续:'));
});

test('buildResult:reasons 数组缺项时,标记位仍要说清为什么', () => {
  const text = buildResult(ctx({
    reconcile: reconcile({ ok: false, reasons: [], reason: 'truncated', truncated: true, emptyForums: true, unresolvedAccounts: ['bob'] }),
  }));
  for (const why of ['被截断', '列表为空', '没取到']) assert.ok(text.includes(why), why);
  assert.ok(text.includes('未能核对:bob'));
});

test('buildResult:逐账号对账状态与未签吧名跟在账号行后', () => {
  const text = buildResult(ctx({
    accounts: [account('alice', { signed: 1 }), account('bob', { failed: 1 })],
    reconcile: reconcile({
      ok: false,
      reason: 'missing',
      reasons: ['missing'],
      missingTotal: 2,
      perAccount: [
        entry('alice', { ok: false, reason: 'missing', reasons: ['missing'], missing: ['吧一', '吧二'] }),
        entry('bob', { ok: null, reason: 'list-failed', reasons: ['list-failed'] }),
      ],
    }),
  }));
  assert.ok(text.includes('账号 alice · 已签 1 · 已签过 0 · 不可签 0 · tbs 失效 0 · 失败 0 · 对账 未通过'));
  assert.ok(text.includes('  未签:吧一 · 吧二'));
  assert.ok(text.includes('账号 bob · 已签 0 · 已签过 0 · 不可签 0 · tbs 失效 0 · 失败 1 · 对账 未能核对'));
});

test('buildResult:多账号顺序按传入顺序,不重排', () => {
  const text = buildResult(ctx({
    accounts: [account('bob'), account('alice'), account('carol')],
    reconcile: reconcile({ perAccount: [entry('bob'), entry('alice'), entry('carol')] }),
  }));
  const names = text.split('\n').filter((line) => line.startsWith('账号 ')).map((line) => line.split(' ')[1]);
  assert.deepEqual(names, ['bob', 'alice', 'carol']);
});

test('buildResult:屏蔽吧如实列出且与失败分开', () => {
  const text = buildResult(ctx({
    accounts: [account('alice', { blocked: 1 })],
    reconcile: reconcile({ blockedTotal: 1, perAccount: [entry('alice', { blocked: ['吧X'] })] }),
  }));
  assert.ok(text.includes('不可签:吧X'));
  assert.ok(!text.includes('  未签:吧X'));
});

test('buildResult:账号级失败与列表异常按账号如实标注', () => {
  const text = buildResult(ctx({
    accounts: [
      account('alice', {}, { ok: false, error: '取 tbs 失败', reason: 'auth' }),
      account('bob', {}, { emptyForums: true, incompleteForums: true }),
    ],
  }));
  assert.ok(text.includes('  原因:取 tbs 失败'));
  assert.ok(text.includes('关注列表为空'));
  assert.ok(text.includes('关注列表被截断'));
});

test('buildStart:一行四段式,账号数随传入', () => {
  assert.equal(buildStart(ctx()), '百度贴吧签到 · alice · 2026-10-11 · 开始运行');
  const two = buildStart(ctx({ accounts: [account('a'), account('b')] }));
  assert.equal(two, '百度贴吧签到 · 2 个账号 · 2026-10-11 · 开始运行');
  assert.equal(two.includes('\n'), false);
});

test('buildSkip:标题 + 原因 / 后续 / 你需要做什么', () => {
  const lines = buildSkip(ctx({ reason: 'peer-running' })).split('\n');
  assert.equal(lines[0], '百度贴吧签到 · alice · 2026-10-11 · 正常跳过');
  assert.equal(lines[1], '');
  assert.equal(lines[2], '原因:同伴程序正在运行');
  assert.match(lines[3], /^后续:.+/);
  assert.equal(lines[4], '你需要做什么:不需要');
});

test('buildAction:请你开头 + 原因 + 不处理的后果', () => {
  const lines = buildAction(ctx({ reason: 'credentials-invalid' })).split('\n');
  assert.equal(lines[0], '百度贴吧签到 · alice · 2026-10-11 · 需要你处理');
  assert.match(lines[2], /^请你:/);
  assert.match(lines[3], /^原因:.+/);
  assert.match(lines[4], /^不处理的后果:.+/);
});

test('buildResult:dryRun 用预览动作词,不报对账结论', () => {
  const text = buildResult(ctx({ dryRun: true, reconcile: reconcile({ ok: null, reasons: [] }) }));
  assert.equal(actionWord(text), '预览,未运行');
  assert.ok(!text.includes('未能核对'));
  assert.ok(!text.includes('对账 '));
  assert.ok(!text.includes('不可签:'));
});

test('buildSkip:动作类原因不会谎称不需要处理', () => {
  const text = buildSkip(ctx({ reason: 'credentials-invalid' }));
  assert.ok(text.includes('你需要做什么:重新登录百度贴吧'), text);
  assert.ok(!text.includes('你需要做什么:不需要'));
});
