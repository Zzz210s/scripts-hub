// T9 离线集成测试:runOnce 的编排(守卫 -> 锁 -> 只读体检 -> 签到 -> 读回 -> 落盘 -> 返回值)。
// fetchImpl 全是桩,不发真实请求;状态与锁写在 os.tmpdir 的临时目录,不碰仓库里的 data/。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { PATHS } from '../src/crypto.js'
import { runOnce } from '../src/run.js'
import { historyFile, stateFile } from '../src/state.js'
import { DAY, NOW, configFor, countOf, harness, okYunbei, readStateFile, stubFetch, tempDir } from './run-harness.js'

test('乐签成功:两条请求都生效,读回确认后锁当天并落历史', async () => {
  const root = tempDir()
  const config = configFor(root)
  const { calls, fetchImpl } = stubFetch({
    ...okYunbei(),
    [PATHS.vipSign]: { body: { code: 200, data: { sign: true } } },
    [PATHS.vipCheckinDetail]: { body: { code: 200, data: { sign: true } } },
  })
  const { deps, sent } = harness({ fetchImpl, root, config })

  const result = await runOnce({ cwd: root, now: NOW, deps })

  assert.equal(result.skipped, false)
  assert.equal(result.ok, true)
  assert.equal(result.exitCode, 0)
  assert.equal(calls.length, 4) // 云贝两条 + 签到两条,逐条串行
  assert.equal(countOf(calls, PATHS.vipSign), 1)
  const state = readStateFile(config)
  assert.equal(state.days[DAY].ok, true) // 锁当天
  assert.equal(state.days[DAY].attempts, 1)
  const rows = fs.readFileSync(historyFile(config.stateDir), 'utf8').trim().split('\n')
  assert.equal(JSON.parse(rows.at(-1)).ok, true)
  assert.equal(sent.some((text) => text.includes('运行成功')), true)
})

test('鉴权失效:只读体检即判死,当天熔断 + 一条 action,只发一次请求', async () => {
  const root = tempDir()
  const config = configFor(root)
  const { calls, fetchImpl } = stubFetch({ [PATHS.yunbeiSignedGet]: { body: { code: 301, data: null } } })
  const { deps, sent } = harness({ fetchImpl, root, config })

  const result = await runOnce({ cwd: root, now: NOW, deps })

  assert.equal(result.skipped, true)
  assert.equal(result.exitCode, 0) // 跳过不是失败
  assert.equal(calls.length, 1) // 凭据类失败不重试,也不发第二条
  assert.equal(sent.length, 1)
  assert.equal(sent[0].includes('需要你处理'), true) // action 提醒重取 cookie
  const state = readStateFile(config)
  assert.equal(state.days[DAY].circuitBroken, true)
  assert.equal(state.days[DAY].circuitKind, 'auth')

  // 同一天再来一次:熔断守卫拦住,一个新请求都不发。
  const again = await runOnce({ cwd: root, now: NOW, deps })
  assert.equal(again.reason, 'circuit-broken')
  assert.equal(calls.length, 1)
})

test('签到阶段鉴权失效:当天熔断,不发读回那条 eapi 请求', async () => {
  const root = tempDir()
  const config = configFor(root)
  const { calls, fetchImpl } = stubFetch({ ...okYunbei(), [PATHS.vipSign]: { body: { code: 447, data: null } } })
  const { deps } = harness({ fetchImpl, root, config })

  const result = await runOnce({ cwd: root, now: NOW, deps })

  assert.equal(result.ok, false)
  assert.equal(result.exitCode, 1)
  assert.equal(countOf(calls, PATHS.vipSign), 1)
  assert.equal(countOf(calls, PATHS.vipCheckinDetail), 0) // 鉴权类失败提前止损
  assert.equal(readStateFile(config).days[DAY].circuitKind, 'auth')
})

test('网络异常:退避重试一次后放弃,不再发第二条请求', async () => {
  const root = tempDir()
  const config = configFor(root)
  const { calls, fetchImpl } = stubFetch({ ...okYunbei(), [PATHS.vipSign]: { throw: 'fetch failed' } })
  const { deps, sleeps, logs } = harness({ fetchImpl, root, config, retryDelayMs: 111 })

  const result = await runOnce({ cwd: root, now: NOW, deps })

  assert.equal(countOf(calls, PATHS.vipSign), 2) // 仅一次重试
  assert.equal(countOf(calls, PATHS.vipCheckinDetail), 0)
  assert.equal(sleeps.filter((ms) => ms === 111).length, 1)
  assert.equal(result.ok, false)
  assert.equal(result.exitCode, 1)
  assert.equal(logs.some((line) => line.includes('运行有失败')), true)
})

test('--dry:不发请求、不写状态、不发送,只预览', async () => {
  const root = tempDir()
  const config = configFor(root)
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    throw new Error('dry 模式不许发请求')
  }
  const { deps, sent, logs } = harness({ fetchImpl, root, config })

  const result = await runOnce({ cwd: root, now: NOW, dryRun: true, deps })

  assert.equal(result.dryRun, true)
  assert.equal(result.reason, 'dry-run')
  assert.equal(result.exitCode, 0)
  assert.equal(calls.length, 0)
  assert.equal(sent.length, 0)
  assert.equal(fs.existsSync(stateFile(config.stateDir)), false)
  assert.equal(fs.existsSync(historyFile(config.stateDir)), false)
  assert.equal(logs.some((line) => line.includes('预览')), true)
})

test('守卫跳过:退出码 0,不取锁不联网;静默原因不推消息', async () => {
  const root = tempDir()
  const config = configFor(root)
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    throw new Error('守卫跳过不该发请求')
  }
  const { deps, sent } = harness({ fetchImpl, root, config, peerRunning: () => true })

  const result = await runOnce({ cwd: root, now: NOW, deps })

  assert.equal(result.skipped, true)
  assert.equal(result.exitCode, 0)
  assert.equal(result.reason, 'peer-running')
  assert.equal(calls.length, 0)
  assert.equal(sent.length, 0) // peer-running 属静默跳过
  assert.equal(fs.existsSync(stateFile(config.stateDir)), false)
})

test('签到阶段 HTTP 429:当天熔断为 rate-limit,不写「结构不符」', async () => {
  const root = tempDir()
  const config = configFor(root)
  const { calls, fetchImpl } = stubFetch({
    ...okYunbei(),
    [PATHS.vipSign]: { status: 429, body: { code: 429 } },
  })
  const { deps, sent } = harness({ fetchImpl, root, config })

  const result = await runOnce({ cwd: root, now: NOW, deps })

  assert.equal(result.exitCode, 1)
  assert.equal(countOf(calls, PATHS.vipSign), 1) // 限流不重试
  assert.equal(countOf(calls, PATHS.vipCheckinDetail), 0) // 也不发读回那条 eapi
  assert.equal(readStateFile(config).days[DAY].circuitKind, 'rate-limit') // 当天熔断
  const text = sent.join('\n')
  assert.equal(text.includes('结构不符'), false)
  assert.equal(text.includes('429'), true)
})

test('体检阶段限流:HTTP 200 + code 429 归 rate-limit,当天熔断', async () => {
  const root = tempDir()
  // 网易 weapi 最常见的限流形状就是 HTTP 200 + body code 429;只带 httpStatus 会掉进 shape。
  const config = {
    ...configFor(root),
    accounts: [
      { id: 'acct-1', name: '账号 1', cookie: 'MUSIC_U=SAMPLE_A' },
      { id: 'acct-2', name: '账号 2', cookie: 'MUSIC_U=SAMPLE_B' },
    ],
  }
  const { calls, fetchImpl } = stubFetch({ [PATHS.yunbeiSignedGet]: { status: 200, body: { code: 429 } } })
  const { deps, sent } = harness({ fetchImpl, root, config })

  const result = await runOnce({ cwd: root, now: NOW, deps })

  assert.equal(result.skipped, true)
  assert.equal(result.reason, 'rate-limit')
  assert.equal(result.exitCode, 0)
  assert.equal(calls.length, 2) // 两个账号各一次体检,失败即停,不发第二条
  assert.equal(readStateFile(config).days[DAY].circuitKind, 'rate-limit')
  const text = sent.join('\n')
  assert.equal(text.includes('过于频繁'), true) // 走 rate-limit 文案
  assert.equal(text.includes('结构与预期不符'), false) // 不是 shape
})

test('首次运行读不到云贝余额:不落基线,下次还能再采', async () => {
  const root = tempDir()
  const config = configFor(root)
  const { fetchImpl } = stubFetch({
    [PATHS.yunbeiSignedGet]: { body: { code: 200, data: { sign: true } } },
    [PATHS.yunbeiTodayGet]: { body: { code: 200, data: {} } },
    [PATHS.vipSign]: { body: { code: 200, data: { sign: true } } },
    [PATHS.vipCheckinDetail]: { body: { code: 200, data: { sign: true } } },
  })
  const { deps } = harness({ fetchImpl, root, config })

  const result = await runOnce({ cwd: root, now: NOW, deps })

  assert.equal(result.ok, true)
  // 落一个 {yunbei:null} 会让「相对基线」永远消失;没有数字就什么都不写。
  assert.equal(readStateFile(config).baseline, null)
})
