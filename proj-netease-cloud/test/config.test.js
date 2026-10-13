// 离线单测:配置读取 config.js。用注入的 fsImpl 造 .env,不读真实文件、不含真实凭据。
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { accountsFrom, DEFAULTS, loadConfig, parseEnv } from '../src/config.js'
import { DEFAULT_LIMITS, checkLocalGuards } from '../src/guards.js'

test('parseEnv:跳过注释与空行,剥成对引号', () => {
  const env = parseEnv('# 注释\n\nACCOUNT_1_MUSIC_U=SAMPLE\nA="quoted"\nB=\'single\'\nBAD\n')
  assert.deepEqual(env, { ACCOUNT_1_MUSIC_U: 'SAMPLE', A: 'quoted', B: 'single' })
})

test('accountsFrom:按 n 数值升序,不是字典序', () => {
  const accounts = accountsFrom({
    ACCOUNT_10_MUSIC_U: 'TEN',
    ACCOUNT_2_MUSIC_U: 'TWO',
    ACCOUNT_1_MUSIC_U: 'ONE',
  })
  assert.deepEqual(
    accounts.map((a) => a.id),
    ['acct-1', 'acct-2', 'acct-10'],
  )
  assert.equal(accounts[0].cookie, 'MUSIC_U=ONE')
  assert.equal(accounts[0].name, '账号 1')
})

test('accountsFrom:只认 MUSIC_U,空值忽略,同名消歧', () => {
  const accounts = accountsFrom({
    ACCOUNT_1_MUSIC_U: 'ONE',
    ACCOUNT_2_MUSIC_U: '',
    ACCOUNT_3_MUSIC_U: 'THREE',
    ACCOUNT_1_NAME: '同名',
    ACCOUNT_3_NAME: '同名',
    ACCOUNT_1_MUSIC_A: 'IGNORED',
  })
  assert.equal(accounts.length, 2)
  assert.equal(accounts[0].name, '同名')
  assert.equal(accounts[1].name, '同名 #3')
})

test('loadConfig:显式 env 覆盖 .env,相对路径按 cwd 拼绝对', () => {
  const cwd = path.join('C:', 'fake-root')
  const fsImpl = {
    existsSync: () => true,
    readFileSync: () => 'ACCOUNT_1_MUSIC_U=FROM_FILE\nNETEASE_TIMEOUT_MS=5000\n',
  }
  const cfg = loadConfig(cwd, { env: { ACCOUNT_1_MUSIC_U: 'FROM_ENV' }, fsImpl })
  assert.equal(cfg.accounts[0].cookie, 'MUSIC_U=FROM_ENV')
  assert.equal(cfg.timeoutMs, 5000)
  assert.equal(cfg.stateDir, path.join(cwd, DEFAULTS.stateDir))
})

test('loadConfig:没有 .env 也能跑,给默认值', () => {
  const cwd = path.join('C:', 'fake-root')
  const fsImpl = { existsSync: () => false, readFileSync: () => '' }
  const cfg = loadConfig(cwd, { env: {}, fsImpl })
  assert.deepEqual(cfg.accounts, [])
  assert.equal(cfg.timeoutMs, DEFAULTS.timeoutMs)
  assert.equal(cfg.dryRun, false)
})

test('守卫阈值只有一份真源:config 的默认值与 guards.DEFAULT_LIMITS 同值', () => {
  for (const key of [
    'quietStart',
    'quietEnd',
    'shutdownTime',
    'shutdownMarginMinutes',
    'minFreeMb',
    'maxAttempts',
  ]) {
    assert.equal(DEFAULTS[key], DEFAULT_LIMITS[key], key)
  }
  // maxAttempts 同时是 checkLocalGuards 的默认参数:只断言两边字段相等抓不住「守卫那份没跟着改」。
  // 这条走行为:不显式传 maxAttempts,DEFAULTS.maxAttempts 次尝试必须恰好被拦下。
  const morning = new Date('2026-10-11T09:00:00')
  assert.equal(checkLocalGuards({ now: morning, attempts: DEFAULTS.maxAttempts }).reason, 'attempts-exhausted')
  assert.equal(checkLocalGuards({ now: morning, attempts: DEFAULTS.maxAttempts - 1 }).reason, 'ok')
})

// 2026-10-14:容器挂载点在宿主上不存在时,Docker 会把 .env 建成**目录** —— 读它会抛 EISDIR。
// 那时应当是「没有配置任何账号」,而不是一条让人去猜挂载的 EISDIR。
test('.env 读不动(例如被挂成目录)时按空配置处理,不抛', () => {
  const fsImpl = {
    existsSync: () => true,
    readFileSync: () => {
      throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' })
    },
  }
  const config = loadConfig('/tmp/whatever', { env: {}, fsImpl })
  assert.deepEqual(config.accounts, [])
})
