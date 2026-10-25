// 逐吧明细消息的用例(与 messages*.test.js 分开,避免单文件超 200 行)。
// 重点:
//   1. 136 个吧要拆成多条,每条 ≤ LIMIT_BYTES,且不把某一行切成两半、一行都不丢;
//   2. 等级只来自接口:取不到写 Lv?;
//   3. 排序:等级高的在前,同等级按吧名;
//   4. 不可签 / 失败单独成段,失败带原因;
//   5. TIEBA_DETAIL=0 不发(run 级用例在 run.test.js)。
import test from 'node:test';
import assert from 'node:assert/strict';

import { LIMIT_BYTES, PROGRAM, buildDetailMessages } from '../src/detail.js';

const bytes = (text) => Buffer.byteLength(text, 'utf8');
const hasParen = (text) => /[()\uFF08\uFF09]/.test(text);
const hasEmoji = (text) => /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u.test(text);

/** 造 136 个已签吧:名字取真机那种长度(4-6 个字),总字节必然超过单条上限。 */
const manyForums = (count = 136) =>
  Array.from({ length: count }, (_, index) => ({
    kw: `大学贴吧${String(index + 1).padStart(3, '0')}`,
    level: (index % 16) + 1,
    status: 'signed',
  }));

/** 明细行:只挑 `... LvN` 那种吧行(区分标题、分组标题与提示行)。 */
const forumLines = (text) => text.split('\n').filter((line) => /^\S+ Lv\d+$/.test(line));

const accounts = (results, name = 'alice') => [{ name, results }];

test('136 个吧:拆成多条,每条在字节上限内,一行不丢也不切断', () => {
  const results = manyForums(136);
  const pages = buildDetailMessages({ date: '2026-10-25', accounts: accounts(results) });
  assert.ok(pages.length >= 2, `136 个吧应该拆成多条,实际 ${pages.length} 条`);
  assert.ok(pages.length <= 4, `不该拆得太碎,实际 ${pages.length} 条`);

  const seen = new Set();
  for (const page of pages) {
    assert.ok(bytes(page) <= LIMIT_BYTES, `单条 ${bytes(page)} 字节超限`);
    // 标题在每一页,多页时带 `续 i/n`
    assert.ok(page.startsWith(`${PROGRAM} · 2026-10-25 · 签到明细`), page.split('\n')[0]);
    for (const line of forumLines(page)) {
      // 一行必须是完整的 `吧名 LvN`;被截断的行会以 ... 结尾
      assert.match(line, /^大学贴吧\d{3} Lv\d+$/, `明细行被破坏:${line}`);
      assert.equal(seen.has(line), false, `重复行:${line}`);
      seen.add(line);
    }
  }
  assert.equal(seen.size, 136, `应该 136 行,实际 ${seen.size}`);
  assert.ok(pages[1].includes('续 2/'), pages[1].split('\n')[0]);
});

test('等级取不到渲染 Lv?,不拿别的数字顶替', () => {
  const pages = buildDetailMessages({
    date: '2026-10-25',
    accounts: accounts([
      { kw: '吧一', level: null, status: 'signed' },
      { kw: '吧二', level: 7, status: 'already' }
    ])
  });
  const text = pages.join('\n');
  assert.ok(text.includes('吧一 Lv?'), text);
  assert.ok(text.includes('吧二 Lv7'), text);
});

test('已签与已签过都算已签,并按等级从高到低排', () => {
  const pages = buildDetailMessages({
    date: '2026-10-25',
    accounts: accounts([
      { kw: '低', level: 2, status: 'signed' },
      { kw: '高', level: 12, status: 'already' },
      { kw: '中', level: 5, status: 'signed' }
    ])
  });
  const lines = pages[0].split('\n').filter((line) => /^.+ Lv\d+$/.test(line));
  assert.deepEqual(lines, ['高 Lv12', '中 Lv5', '低 Lv2']);
  assert.ok(pages[0].includes('已签 3 个'));
});

test('不可签与失败另起两段,失败带原因', () => {
  const pages = buildDetailMessages({
    date: '2026-10-25',
    accounts: accounts([
      { kw: '正常吧', level: 8, status: 'signed' },
      { kw: '屏蔽吧', level: 3, status: 'blocked' },
      { kw: '失败吧', level: 6, status: 'failed' },
      { kw: '过期吧', level: 4, status: 'tbs-stale' }
    ])
  });
  const text = pages.join('\n');
  assert.ok(text.includes('已签 1 个'), text);
  assert.ok(text.includes('不可签 1 个'), text);
  assert.ok(text.includes('失败 2 个'), text);
  assert.ok(text.includes('屏蔽吧'), text);
  assert.ok(text.includes('失败吧 · 失败'), text);
  assert.ok(text.includes('过期吧 · tbs 失效'), text);
  // 三段按「已签 -> 不可签 -> 失败」的顺序成段,且有各自的分组标题
  const at = (needle) => text.indexOf(needle);
  assert.ok(at('已签 1 个') < at('不可签 1 个'), text);
  assert.ok(at('不可签 1 个') < at('失败 2 个'), text);
  assert.ok(at('屏蔽吧') < at('失败吧'), '屏蔽吧应在不可签段内', text);
});

test('多账号时每段带账号名,顺序按传入', () => {
  const pages = buildDetailMessages({
    date: '2026-10-25',
    accounts: [
      { name: 'alice', results: [{ kw: '甲吧', level: 9, status: 'signed' }] },
      { name: 'bob', results: [{ kw: '乙吧', level: 3, status: 'signed' }] }
    ]
  });
  const text = pages.join('\n');
  assert.ok(text.includes('账号 alice'), text);
  assert.ok(text.includes('账号 bob'), text);
  assert.ok(text.indexOf('账号 alice') < text.indexOf('账号 bob'), '账号顺序应与传入一致');
});

test('超过 maxForums 只列前 N 个,并写清还有多少没列', () => {
  const pages = buildDetailMessages({ date: '2026-10-25', accounts: accounts(manyForums(50)), maxForums: 10 });
  const text = pages.join('\n');
  assert.equal(forumLines(text).length, 10);
  assert.ok(text.includes('已签 50 个'), text);
  assert.ok(text.includes('另有 40 个未列出'), text);
});

test('没有可列的吧时返回空数组,不发只有标题的空消息', () => {
  assert.deepEqual(buildDetailMessages({ date: '2026-10-25', accounts: [] }), []);
  assert.deepEqual(buildDetailMessages({ date: '2026-10-25', accounts: [{ name: 'alice', results: [] }] }), []);
  assert.deepEqual(buildDetailMessages({ date: '2026-10-25' }), []);
});

test('脏吧名也守硬规则:无圆括号、无 emoji', () => {
  const pages = buildDetailMessages({
    date: '2026-10-25\u{1F600}',
    accounts: accounts([
      { kw: '吧A(外语)\u{1F600}', level: 8, status: 'signed' },
      { kw: '屏蔽\u{2B50}', level: null, status: 'blocked' }
    ])
  });
  for (const page of pages) {
    assert.equal(hasParen(page), false, page);
    assert.equal(hasEmoji(page), false, page);
  }
  assert.ok(pages[0].includes('吧A 外语'), pages[0]);
});

test('超长吧名(单行超预算)被截断而不是把整条消息撑破', () => {
  const pages = buildDetailMessages({
    date: '2026-10-25',
    accounts: accounts([{ kw: 'x'.repeat(5000), level: 8, status: 'signed' }])
  });
  assert.ok(pages.length >= 1);
  for (const page of pages) assert.ok(bytes(page) <= LIMIT_BYTES, `${bytes(page)} 字节超限`);
  assert.ok(pages.some((page) => page.includes('...')), '截断处要有省略标记');
  assert.ok(pages.join('\n').includes('已签 1 个'), '分组标题不许丢');
});
