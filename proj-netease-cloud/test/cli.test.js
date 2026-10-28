// T9 离线测试:CLI 子命令分派与只读语义。deps 全部注入,不发真实请求、不读 .env。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

// 回归:cli 拆出 commands.js 时漏了 readState 等导入,check 会在容器里直接报 is not defined。
// 这条用例走一遍 check 的离线路径,锁住 commands.js 的依赖完整。
test('check 子命令在离线桩下能跑完并打印账号行', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'netease-check-'))
  fs.mkdirSync(path.join(cwd, 'data'), { recursive: true })
  fs.writeFileSync(path.join(cwd, '.env'), 'ACCOUNT_1_MUSIC_U=' + 'x'.repeat(40) + '\n')
  const lines = []
  const code = await main(['check'], {
    cwd,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
    deps: {
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: 200, data: {} }) }),
      freeMb: () => 4000,
    },
  })
  const text = lines.join('\n')
  assert.ok(text.includes('网易云音乐签到'), `缺少头部:${text}`)
  assert.ok(text.includes('账号 1'), `缺少账号行:${text}`)
  assert.ok(!/is not defined/.test(text), `出现未定义引用:${text}`)
  assert.equal(typeof code, 'number')
})

// 回归:cl 拆出 commands.js 后 sendViaWecom 不再定义在 cli.js 里,漏导入会让消息静默发不出去
// (2026-10-28 真机:签到成功但企业微信两条都没发,日志只有 sendViaWecom is not defined)
test('run 成功后会真的调用发送器,不会因为引用丢失而静默失败', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'netease-send-'))
  fs.writeFileSync(path.join(cwd, '.env'), 'ACCOUNT_1_MUSIC_U=' + 'y'.repeat(40) + '\n')
  const sent = []
  await main(['run'], {
    cwd,
    now: new Date('2026-10-28T12:00:00+08:00'),
    log: () => {},
    error: () => {},
    deps: {
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: 200, data: true }) }),
      freeMb: () => 4000,
      readState: () => ({ state: { days: {} }, warnings: [] }),
      send: async (text) => { sent.push(text); return { ok: true } },
    },
  })
  assert.ok(sent.length >= 1, '至少要发出一条消息')
  assert.ok(!/is not defined/.test(sent.join('\n')))
})
