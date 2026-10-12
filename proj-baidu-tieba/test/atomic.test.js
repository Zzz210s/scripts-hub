// Task 6:原子写与安全读。全部离线,不碰网络。
// Windows 重试是既有项目的实测教训:rename 覆盖时会被杀毒/索引服务短暂占用而抛 EPERM/EBUSY。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readJsonSafe, writeAtomic } from '../src/atomic.js';

/** 每个用例一个临时目录,避免互相污染。 */
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-atomic-'));

/** 让前 times 次 renameSync 抛错、之后放行的真实 fs 包装。 */
function flakyRename(code, times = 1) {
  let left = times;
  return {
    ...fs,
    renameSync(from, to) {
      if (left-- > 0) {
        const error = new Error(`${code}: 目标被占用`);
        error.code = code;
        throw error;
      }
      return fs.renameSync(from, to);
    },
  };
}

test('writeAtomic:rename 抛 EPERM 时重试后写成功', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'nested', 'state.json');
  const sleeps = [];
  writeAtomic(file, '{"ok":true}', { fsImpl: flakyRename('EPERM'), sleep: (ms) => sleeps.push(ms) });
  assert.equal(fs.readFileSync(file, 'utf8'), '{"ok":true}');
  assert.deepEqual(sleeps, [20]);
});

test('writeAtomic:EBUSY 与 EACCES 同样重试,临时文件不残留', () => {
  const dir = tmpDir();
  for (const code of ['EBUSY', 'EACCES']) {
    const file = path.join(dir, `${code}.json`);
    writeAtomic(file, code, { fsImpl: flakyRename(code, 2), sleep: () => {} });
    assert.equal(fs.readFileSync(file, 'utf8'), code);
    assert.equal(fs.existsSync(`${file}.tmp-${process.pid}`), false);
  }
});

test('writeAtomic:不可重试的错误照抛,临时文件清掉', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'state.json');
  assert.throws(() => writeAtomic(file, 'x', { fsImpl: flakyRename('ENOSPC', 99), sleep: () => {} }), /ENOSPC/);
  assert.equal(fs.existsSync(`${file}.tmp-${process.pid}`), false);
});

test('writeAtomic:重试次数用尽也抛错', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'state.json');
  assert.throws(
    () => writeAtomic(file, 'x', { fsImpl: flakyRename('EPERM', 99), retries: 2, sleep: () => {} }),
    /EPERM/,
  );
});

test('readJsonSafe:缺失给 fallback,坏 JSON 给 fallback 加错误消息', () => {
  const dir = tmpDir();
  assert.deepEqual(readJsonSafe(path.join(dir, 'none.json'), { fallback: true }), {
    value: { fallback: true },
    error: null,
  });
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{oops', 'utf8');
  const { value, error } = readJsonSafe(broken, null);
  assert.equal(value, null);
  // 自带文案里不许有圆括号;后面的解析细节来自运行时,不属于我们的文案。
  assert.equal(error.startsWith(`${broken} 不是合法 JSON:`), true);
});
