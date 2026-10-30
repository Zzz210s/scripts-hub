// 互动结果行的渲染:数字必须来自实测字段,风控与失败要说人话。
// 顺便盯住硬规则:不用圆括号、不用 emoji。

import assert from 'node:assert/strict';
import test from 'node:test';

import { interactLines } from '../src/interact-run.js';

const stats = (over = {}) => ({
  posts: 0,
  likes: 0,
  alreadyLiked: 0,
  skipped: 0,
  failures: [],
  risk: null,
  perForum: {},
  expBefore: 0,
  ...over,
});

test('正常一轮:回帖 · 点赞 · 经验增量三件事都在', () => {
  const lines = interactLines({ 'acct-1': { stats: stats({ posts: 544, likes: 136 }), expGained: 544 } });
  assert.deepEqual(lines, ['互动 · 回帖 544 · 点赞 136 · 经验 +544']);
});

test('跳过与失败各自成词,风控停下要说清原因', () => {
  const lines = interactLines({
    'acct-1': {
      stats: stats({ posts: 12, likes: 2, skipped: 120, failures: [{ kw: 'a', error: 'x' }], risk: '需要验证码' }),
      expGained: 12,
    },
  });
  assert.match(lines[0], /跳过 120/);
  assert.match(lines[0], /失败 1/);
  assert.match(lines[0], /风控中途停下:需要验证码/);
});

test('没有列表时明确说未执行,不静默省略', () => {
  const lines = interactLines({ 'acct-2': { ok: false, error: '这一轮没有可用的关注列表', stats: null } });
  assert.match(lines[0], /未执行/);
  assert.match(lines[0], /没有可用的关注列表/);
});

test('没有结果就一行都不加', () => {
  assert.deepEqual(interactLines({}), []);
  assert.deepEqual(interactLines(), []);
});

test('硬规则:不含圆括号与 emoji', () => {
  const lines = interactLines({ 'acct-1': { stats: stats({ posts: 1, likes: 1, risk: '需要验证码' }), expGained: 1 } });
  for (const line of lines) {
    assert.doesNotMatch(line, /[()（）]/);
    assert.doesNotMatch(line, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  }
});
