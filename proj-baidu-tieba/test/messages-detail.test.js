// 逐吧明细并进结果消息的用例(不单独发消息)。重点:
//   1. 136 个真实量级的吧要全部列出,整条 ≤ 2048 字节;
//   2. 装不下时从等级最低的组整组丢,并写清还差多少个;
//   3. 等级只来自接口:取不到写 Lv?;
//   4. 结论行(对账)在任何情况下都不被挤掉;
//   5. TIEBA_DETAIL=0 时完全不列明细;
//   6. 脏吧名同样守「无圆括号、无 emoji」。
import test from 'node:test';
import assert from 'node:assert/strict';

import { LIMIT_BYTES, buildResult } from '../src/messages.js';
import { renderForumSection } from '../src/detail.js';

const bytes = (text) => Buffer.byteLength(text, 'utf8');
const hasParen = (text) => /[()\uFF08\uFF09]/.test(text);
const hasEmoji = (text) => /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u.test(text);

// 真机等级分布(Lv8:77 · Lv7:10 · Lv6:10 · Lv5:11 · Lv4:28),吧名取真机那种长度。
const LEVELS = [8, 7, 6, 5, 4];
const COUNTS = [77, 10, 10, 11, 28];
const forumRows = (count = 136, { levelOffset = 0 } = {}) => {
  const rows = [];
  let index = 0;
  const name = (n, kind) => `${
    kind % 2 === 0 ? '贴吧' : '测试吧'
  }${n}`;
  for (let group = 0; group < LEVELS.length && rows.length < count; group += 1) {
    for (let k = 0; k < COUNTS[group] && rows.length < count; k += 1) {
      index += 1;
      rows.push({ kw: name(index, index), level: Math.max(1, LEVELS[group] - levelOffset), status: 'signed' });
    }
  }
  while (rows.length < count) {
    index += 1;
    rows.push({ kw: name(index, index), level: 3, status: 'signed' });
  }
  return rows;
};

const accountsOf = (results, name = '账号 1') => [
  { id: 'a1', name, ok: true, counts: { signed: results.length, already: 0, blocked: 0, tbsStale: 0, failed: 0 }, results },
];
const reconcileOk = (name = '账号 1') => ({
  ok: true, missingTotal: 0, blockedTotal: 0, reasons: ['ok'], reason: 'ok',
  perAccount: [{ id: 'a1', name, ok: true, missing: [], blocked: [] }],
});
const render = (results, extra = {}) =>
  buildResult({ date: '2026-10-25', accounts: accountsOf(results), reconcile: reconcileOk(), exitCode: 0, detail: { enabled: true, maxForums: 200 }, ...extra });

test('逐行渲染的仿真规模与真机同量级(基准:2038 字节)', () => {
  const lines = forumRows().map((row) => `${row.kw} Lv${row.level}`);
  const size = bytes(lines.join('\n'));
  assert.ok(size >= 1900 && size <= 2150, `仿真规模偏离真机:${size}`);
});

test('136 个吧:全部列出,整条 ≤ 2048 字节', () => {
  const rows = forumRows();
  const text = render(rows);
  assert.ok(bytes(text) <= LIMIT_BYTES, `${bytes(text)} 字节超限`);
  const missing = rows.filter((row) => !text.includes(String(row.kw)));
  assert.deepEqual(missing.map((row) => row.kw), [], '明细里有吧没被列出');
  assert.equal(text.includes('另有'), false, '全都列出来了就不该有省略提示');
  assert.ok(text.includes('Lv8 '), '要按等级分组');
  assert.ok(text.indexOf('Lv8 ') < text.indexOf('Lv7 '), '等级从高到低');
  assert.ok(text.includes('已签 136'), '账号统计仍在');
  assert.ok(text.includes('对账:通过'), '结论行仍在');
});

test('吧数放大到 400:仍 ≤ 2048,且写清还有多少没列', () => {
  const text = render(forumRows(400));
  assert.ok(bytes(text) <= LIMIT_BYTES, `${bytes(text)} 字节超限`);
  assert.match(text, /另有 \d+ 个未列出 · 按等级从高到低/);
  assert.ok(text.includes('对账:通过'), '结论行不许被挤掉');
  // 丢掉的是等级最低的组:高等级必须还在
  assert.ok(text.includes('Lv8 '), '最高的那一组不该先被丢');
  assert.equal(text.includes('Lv3 '), false, '最低等级应该先被丢');
});

test('等级取不到渲染 Lv?,不拿别的数字顶替', () => {
  const text = render([
    { kw: '吧一', level: null, status: 'signed' },
    { kw: '吧二', level: 7, status: 'already' }
  ]);
  assert.ok(text.includes('Lv? 吧一'), text);
  assert.ok(text.includes('Lv7 吧二'), text);
  assert.ok(text.indexOf('Lv7 ') < text.indexOf('Lv? '), '未知等级排最后');
});

test('不可签与失败排在明细最前面,失败带原因', () => {
  const text = render([
    { kw: '正常吧', level: 8, status: 'signed' },
    { kw: '屏蔽吧', level: 3, status: 'blocked' },
    { kw: '失败吧', level: 6, status: 'failed' },
    { kw: '过期吧', level: 4, status: 'tbs-stale' }
  ]);
  assert.ok(text.includes('不可签 屏蔽吧'), text);
  assert.ok(text.includes('失败 失败吧 · 失败'), text);
  assert.ok(text.includes('失败 过期吧 · tbs 失效'), text);
  assert.ok(text.indexOf('不可签 屏蔽吧') < text.indexOf('Lv8 '), '不可签在最前面');
});

test('TIEBA_DETAIL=0 时结果里没有明细', () => {
  const rows = forumRows(5);
  const text = render(rows, { detail: { enabled: false, maxForums: 200 } });
  assert.equal(/Lv\d+ 贴吧/.test(text), false, text);
  assert.ok(text.includes('已签 5'), '汇总数字还在');
  assert.ok(text.includes('对账:通过'), '结论行还在');
});

test('最坏情况:超长账号名 + 400 个吧 —— 结论行仍完整', () => {
  const rows = forumRows(400);
  const accounts = accountsOf(rows, '名'.repeat(400));
  const text = buildResult({
    date: '2026-10-25', accounts, reconcile: reconcileOk('名'.repeat(400)), exitCode: 0,
    detail: { enabled: true, maxForums: 200 },
  });
  assert.ok(bytes(text) <= LIMIT_BYTES, `${bytes(text)} 字节超限`);
  assert.ok(text.includes('对账:通过'), '结论行必须保留');
  assert.ok(text.includes('后续:今天已完成'), '后续行必须保留');
});

test('预算连一行明细都放不下时不列,不输出半行', () => {
  const section = renderForumSection(accountsOf(forumRows(3)), { budget: 5 });
  assert.deepEqual(section.lines, []);
  assert.equal(section.dropped, 3);
});

test('脏吧名也守硬规则:无圆括号、无 emoji', () => {
  const text = render([
    { kw: '吧A(外语)\u{1F600}', level: 8, status: 'signed' },
    { kw: '屏蔽\u{2B50}', level: null, status: 'blocked' }
  ]);
  assert.equal(hasParen(text), false, text);
  assert.equal(hasEmoji(text), false, text);
  assert.ok(text.includes('吧A 外语'), text);
});
