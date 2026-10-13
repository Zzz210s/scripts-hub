// 守卫跳过的推送路由:哪些原因静默、哪些推 action。与 run.test.js 分开是按主题拆文件,
// 好让两个文件都留在 200 行以内。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { runOnce } from '../src/run.js'
import { emptyState, setPaused, stateFile, writeState } from '../src/state.js'
import { NOW, configFor, harness, tempDir } from './run-harness.js'

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
test('已暂停与内存不足属静默集合 → 不推送', async () => {
  // 2026-10-13 裁决:paused 是人自己按的、low-memory 是瞬时压力且当天还会再试,都属
  // 「不需要人现在动手」;而 attempts-exhausted / before-shutdown 意味着今天可能跑不成,
  // 仍要推 action —— 那两条的守卫与推送路由另有用例覆盖。
  const cases = [
    // paused 走状态文件(state.paused),不是 deps 入参 —— 按真实路径造。
    { writePaused: true },
    { extra: { freeMb: () => 10 } },
  ]
  for (const testCase of cases) {
    const root = tempDir()
    const config = configFor(root)
    if (testCase.writePaused) {
      const state = emptyState(NOW)
      setPaused(state, true)
      fs.mkdirSync(config.stateDir, { recursive: true })
      writeState(state, config.stateDir, NOW)
    }
    const fetchImpl = async () => {
      throw new Error('守卫跳过不该发请求')
    }
    const { deps, sent } = harness({ fetchImpl, root, config, ...(testCase.extra ?? {}) })

    const result = await runOnce({ cwd: root, now: NOW, deps })

    assert.equal(result.skipped, true)
    assert.equal(result.exitCode, 0)
    assert.equal(sent.length, 0)
  }
})
