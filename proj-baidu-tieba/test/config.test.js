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
});

test('没有账号时 accounts 为空、filter 为 null、默认值可用', () => {
  const config = loadConfig('/no/such/dir', { env: {} });
  assert.deepEqual(config.accounts, []);
  assert.equal(config.filter, null);
  assert.equal(config.maxAttempts, 3);
  assert.equal(config.intervalMs, 2000);
  assert.deepEqual(config.busyPeers, []);
});
