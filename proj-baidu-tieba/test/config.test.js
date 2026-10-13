// Task 9 配置读取:`.env` 与显式 env 两个来源,账号来自 ACCOUNT_n_BDUSS。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConfig, parseEnv } from '../src/config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-cfg-'));

test('parseEnv 读键值、跳过注释与空行、剥引号', () => {
  assert.deepEqual(parseEnv('# 注释\nA=1\nB="x y"\n\nC=\n'), { A: '1', B: 'x y', C: '' });
});

test('loadConfig 从 env 读账号、名称、cookie 组合与阈值', () => {
  const config = loadConfig('/no/such/dir', {
    env: {
      ACCOUNT_1_BDUSS: 'A',
      ACCOUNT_2_BDUSS: 'B',
      ACCOUNT_2_STOKEN: 'S',
      ACCOUNT_2_NAME: '小号',
      TIEBA_INTERVAL_MS: '1500',
      TIEBA_MAX_ATTEMPTS: '5',
      TIEBA_FORUMS: 'a, b',
    },
  });
  assert.equal(config.accounts.length, 2);
  assert.equal(config.accounts[0].name, '账号 1');
  assert.equal(config.accounts[0].cookie, 'BDUSS=A');
  assert.equal(config.accounts[1].name, '小号');
  assert.equal(config.accounts[1].cookie, 'BDUSS=B; STOKEN=S');
  assert.equal(config.intervalMs, 1500);
  assert.equal(config.maxAttempts, 5);
  assert.deepEqual(config.filter, ['a', 'b']);
});

test('loadConfig 读 <cwd>/.env,显式 env 覆盖文件里同名键', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.env'), 'ACCOUNT_1_BDUSS=FILE\nTIEBA_INTERVAL_MS=999\n');
  const config = loadConfig(dir, { env: { TIEBA_INTERVAL_MS: '111' } });
  assert.equal(config.accounts[0].cookie, 'BDUSS=FILE');
  assert.equal(config.intervalMs, 111);
  assert.equal(config.stateDir, path.join(dir, 'data'));
  // 锁另放 logs/:套件约定是「每个程序把锁写在 logs/run.lock」,状态仍留 data/。
  assert.equal(config.lockDir, path.join(dir, 'logs'));
});

test('重名账号自动消歧且 id 唯一;maxAttempts 的 0 回落默认值', () => {
  const config = loadConfig('/no/such/dir', {
    env: {
      ACCOUNT_1_BDUSS: 'A',
      ACCOUNT_2_BDUSS: 'B',
      ACCOUNT_1_NAME: '同名',
      ACCOUNT_2_NAME: '同名',
      TIEBA_MAX_ATTEMPTS: '0',
    },
  });
  assert.deepEqual(config.accounts.map((one) => one.name), ['同名', '同名 #2']);
  assert.equal(new Set(config.accounts.map((one) => one.id)).size, 2);
  assert.equal(config.maxAttempts, 3); // 0 会让守卫恒真、永远不签
});

test('没有账号时 accounts 为空、filter 为 null、默认值可用', () => {
  const config = loadConfig('/no/such/dir', { env: {} });
  assert.deepEqual(config.accounts, []);
  assert.equal(config.filter, null);
  assert.equal(config.maxAttempts, 3);
  assert.equal(config.intervalMs, 2000);
  assert.deepEqual(config.busyPeers, []);
});

test('TIEBA_LOCK_DIR 可覆盖锁目录,相对路径按 cwd 展开', () => {
  assert.equal(loadConfig('/srv/tieba', { env: { TIEBA_LOCK_DIR: '/var/lock/tieba' } }).lockDir, '/var/lock/tieba');
  assert.equal(loadConfig('/srv/tieba', { env: { TIEBA_LOCK_DIR: 'locks' } }).lockDir, path.join('/srv/tieba', 'locks'));
});

// 2026-10-14:容器挂载点在宿主上不存在时,Docker 会把 .env 建成**目录** —— 读它会抛 EISDIR。
// 那时应当是「没有配置任何账号」,而不是一条让人去猜挂载的 EISDIR。
test('.env 读不动(例如被挂成目录)时按空配置处理,不抛', () => {
  const fsImpl = {
    existsSync: () => true,
    readFileSync: () => {
      throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' });
    },
  };
  const config = loadConfig('/tmp/whatever', { env: {}, fsImpl });
  assert.deepEqual(config.accounts, []);
});
