// Task 8 规则用例:全局硬规则与长度护栏。与 messages.test.js 分开,避免单文件超 200 行。
//   1. 四类消息都不许出现圆括号(全角半角)与 emoji;
//   2. 原因词表覆盖守卫全部取值,未知码有显式兜底,不渲染 undefined 或空串;
//   3. 企业微信 2048 字节上限:超长按整行截断并保留标题与结论行。
import test from 'node:test';
import assert from 'node:assert/strict';

import { REASONS, buildAction, buildResult, buildSkip, buildStart } from '../src/messages.js';
import { account, ctx, entry, reconcile } from './messages-helpers.js';

const LIMIT = 2048;
const bytes = (text) => Buffer.byteLength(text, 'utf8');
const hasParen = (text) => /[()\uFF08\uFF09]/.test(text);
const hasEmoji = (text) => /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u.test(text);

/** 守卫给出的全部机器可读码(设计文档 + Task 7)。 */
/** 守卫给出的全部机器可读码(设计文档 + Task 7);`ok` 是守卫放行时的码,同样要有文案。 */
const CODES = ['ok', 'paused', 'done-today', 'attempts-exhausted', 'peer-running', 'quiet-hours', 'before-shutdown', 'low-memory', 'no-credentials', 'credentials-invalid', 'list-failed'];

test('四类消息都不能有圆括号,也不能有 emoji —— 动态文本同样成立', () => {
  // 脏输入:账号名 / 日期 / 上游 error / 吧名 / 原因码 都带上 emoji 与圆括号
  const dirty = ctx({
    date: '2026-10-11\u{1F600}',
    accounts: [
      account('alice\u{1F600}\u{2B50}', { signed: 1 }, { ok: false, error: 'HTTP 500 (nginx) \u{1F600}', reason: 'http' }),
      account('bob', { failed: 1 }, { emptyForums: true }),
    ],
    reason: 'done-today\u{1F600}',
    reconcile: reconcile({
      ok: false,
      reason: 'missing\u{1F600}',
      reasons: ['missing\u{1F600}', 'truncated'],
      truncated: true,
      missingTotal: 1,
      unresolvedAccounts: ['carol\u{2B50}'],
      perAccount: [
        entry('alice\u{1F600}\u{2B50}', { ok: false, reason: 'missing', reasons: ['missing'], missing: ['吧(外语)\u{1F600}'], blocked: ['屏蔽\u{2B50}'] }),
        entry('bob', { ok: null, reason: 'list-failed\u{1F600}', reasons: ['list-failed\u{1F600}'] }),
      ],
    }),
  });
  const samples = [
    buildStart(dirty),
    buildResult(dirty),
    buildResult({ ...dirty, dryRun: true, reconcile: null }),
    buildSkip(dirty),
    buildAction(dirty),
    buildSkip({ ...dirty, reason: 'wat-now\u{1F600}' }),
    buildAction({ ...dirty, reason: 'wat-now\u{1F600}' }),
  ];
  for (const text of samples) {
    assert.equal(hasParen(text), false, text);
    assert.equal(hasEmoji(text), false, text);
  }
  // 消毒不是把内容整段删掉:读得懂的正文必须还在
  const result = buildResult(dirty);
  assert.ok(result.includes('账号 alice'), result);
  assert.ok(result.includes('未签:吧 外语'), result);
  assert.ok(result.includes('2026-10-11'), result);
  assert.ok(result.includes('HTTP 500 nginx'), result);
});

test('原因词表覆盖守卫全部取值,每个码都能渲染', () => {
  assert.deepEqual(Object.keys(REASONS).sort(), [...CODES].sort());
  for (const code of CODES) {
    assert.ok(REASONS[code].text, code);
    assert.ok(REASONS[code].followUp, code);
    const skip = buildSkip(ctx({ reason: code }));
    assert.ok(!skip.includes('未识别'), code);
    assert.ok(!skip.includes('undefined'), code);
  }
  for (const code of ['no-credentials', 'credentials-invalid', 'list-failed']) assert.ok(REASONS[code].action, code);
});

test('未知原因码有显式兜底,不渲染 undefined 或空串', () => {
  for (const build of [buildSkip, buildAction]) {
    const text = build(ctx({ reason: 'wat-now' }));
    assert.ok(text.includes('wat-now'), text);
    assert.ok(!text.includes('undefined'));
    assert.ok(!/原因:[ \t]*$/m.test(text));
  }
});

test('守卫放行码 ok 有自己的文案,不被当成未知码', () => {
  assert.ok(Object.keys(REASONS).includes('ok'), 'REASONS 应有 ok 键');
  const text = buildSkip(ctx({ reason: 'ok' }));
  assert.ok(text.includes('原因:当前状态正常'), text);
  assert.ok(!text.includes('未识别'), text);
  assert.ok(!text.includes('undefined'));
});

test('账号级失败的原因码用自己的文案,不复用「跳过原因」措辞', () => {
  const text = buildResult(ctx({ accounts: [account('alice', {}, { ok: false, error: null, reason: 'auth' })] }));
  assert.ok(text.includes('原因:服务器判定登录状态已失效'), text);
  assert.ok(!text.includes('未识别的跳过原因'), text);
  // 没收录的码也要诚实兜底,不渲染 undefined 或空串
  const unknown = buildResult(ctx({ accounts: [account('bob', {}, { ok: false, error: '', reason: 'wat' })] }));
  assert.ok(unknown.includes('账号级失败,机器码 wat'), unknown);
});

test('动态文本里的圆括号被消毒,不破坏硬规则', () => {
  const text = buildResult(ctx({
    accounts: [{ name: '甲(小号)', ok: false, counts: { signed: 1 }, error: 'HTTP 500 Service Unavailable (nginx)', reason: 'http' }],
    reconcile: reconcile({
      ok: false,
      reason: 'missing',
      reasons: ['missing'],
      missingTotal: 1,
      perAccount: [entry('甲(小号)', { ok: false, reason: 'missing', reasons: ['missing'], missing: ['吧A(外语)'] })],
    }),
  }));
  assert.equal(hasParen(text), false, text);
  assert.ok(text.includes('甲 小号'), text);
  assert.ok(text.includes('吧A 外语'), text);
  assert.ok(text.includes('HTTP 500 Service Unavailable nginx'), text);
});

test('长度护栏:超长输入也压在 2048 字节内且保留标题与对账结论', () => {
  const accounts = Array.from({ length: 60 }, (_, i) => account(`长账号名${i}${'x'.repeat(20)}`, { signed: i, failed: i }));
  const text = buildResult(ctx({
    accounts,
    reconcile: reconcile({
      ok: false,
      reason: 'missing',
      reasons: ['missing'],
      missingTotal: 3,
      perAccount: accounts.map((a) => entry(a.name, { ok: false, reason: 'missing', reasons: ['missing'], missing: ['某吧'] })),
    }),
  }));
  assert.ok(bytes(text) <= LIMIT, `实际 ${bytes(text)} 字节`);
  assert.ok(text.startsWith('百度贴吧签到 · 60 个账号 · 2026-10-11 · '), text.slice(0, 80));
  assert.ok(text.includes('对账:未通过'));
  assert.ok(text.includes('已省略'));
  // start 也在护栏内:单个超长账号名不许突破上限
  const longStart = buildStart({ date: '2026-10-11', accounts: [{ name: 'x'.repeat(5000) }] });
  assert.ok(bytes(longStart) <= LIMIT, `实际 ${bytes(longStart)} 字节`);
  assert.ok(longStart.includes('...'), '超长标题要有省略标记');
});

test('长度护栏:超长标题被截断且补省略标记,不伪装成完整名字', () => {
  const text = buildResult(ctx({ accounts: [account(`${'x'.repeat(3000)}\u{1F600}`, { signed: 1 })] }));
  assert.ok(bytes(text) <= LIMIT, `实际 ${bytes(text)} 字节`);
  assert.ok(text.startsWith('百度贴吧签到 · '), text.slice(0, 40));
  assert.ok(text.includes('...'), text.slice(-80));
  assert.ok(text.includes('对账:通过'), `结论行不许先掉:${text.slice(-80)}`);
});
