// T9 离线测试:CLI 子命令分派与只读语义。deps 全部注入,不发真实请求、不读 .env。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { main } from '../src/cli.js'
import { PATHS } from '../src/crypto.js'
import { stateFile } from '../src/state.js'
import { configFor, countOf, stubFetch, tempDir } from './run-harness.js'

const NOW = new Date(2026, 9, 11, 10, 0, 0)

/** 统一注入:config 已给,不用读 .env;sleep 立即返回。 */
function cli(player) {
  const { fetchImpl, calls } = player
  const sent = []
  const logs = []
  const errors = []
  const deps = {
    config: player.config,
    fetchImpl,
    sleep: async () => {},
    send: async (text) => {
      sent.push(text)
      return { ok: true }
    },
  }
  const options = {
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    cwd: player.root,
    now: NOW,
    deps,
    env: {},
  }
  return { run: (argv) => main(argv, options), sent, logs, errors, calls }
}

test('help:打印用法并返回 0;未知子命令返回 2', async () => {
  const root = tempDir()
  const io = cli({ root, config: configFor(root) })
  assert.equal(await io.run(['help']), 0)
  assert.equal(io.logs[0].includes('用法'), true)
  assert.equal(await io.run(['bogus']), 2)
  assert.equal(io.errors.length, 1)
})

test('run --dry:只预览,不发请求不写状态不发送', async () => {
  const root = tempDir()
  const config = configFor(root)
  let calls = 0
  const io = cli({
    root,
    config,
    fetchImpl: async () => {
      calls += 1
      throw new Error('dry 不许发请求')
    },
  })

  assert.equal(await io.run(['run', '--dry']), 0)
  assert.equal(calls, 0)
  assert.equal(io.sent.length, 0)
  assert.equal(fs.existsSync(stateFile(config.stateDir)), false)
})

test('probe:只打只读接口,绝不调用签到,也不写状态', async () => {
  const root = tempDir()
  const config = configFor(root)
  const { calls, fetchImpl } = stubFetch({
    [PATHS.vipSignInfo]: { body: { code: 200, data: { sign: true } } },
    [PATHS.yunbeiSignedGet]: { body: { code: 200, data: { sign: true, yunbeiNum: 120 } } },
    [PATHS.yunbeiTodayGet]: { body: { code: 200, data: { yunbeiNum: 120 } } },
  })
  const io = cli({ root, config, fetchImpl })

  assert.equal(await io.run(['probe']), 0)
  assert.equal(countOf(calls, PATHS.vipSign), 0)
  assert.equal(countOf(calls, PATHS.vipCheckinDetail), 0)
  assert.equal(fs.existsSync(stateFile(config.stateDir)), false)
  assert.equal(io.logs.some((line) => line.includes('未发送任何签到请求')), true)
})

test('check/probe:没有账号时返回 1,不做任何请求', async () => {
  const root = tempDir()
  const config = { ...configFor(root), accounts: [] }
  let calls = 0
  const io = cli({
    root,
    config,
    fetchImpl: async () => {
      calls += 1
      throw new Error('没有账号不该发请求')
    },
  })

  assert.equal(await io.run(['check']), 1)
  assert.equal(await io.run(['probe']), 1)
  assert.equal(calls, 0)
})

test('report:当天没有历史记录时返回 0,只提示不发送', async () => {
  const root = tempDir()
  const io = cli({ root, config: configFor(root) })
  assert.equal(await io.run(['report']), 0)
  assert.equal(io.sent.length, 0)
  assert.equal(io.logs.some((line) => line.includes('当天还没有运行记录')), true)
})
