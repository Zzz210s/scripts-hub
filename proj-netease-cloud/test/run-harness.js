// run.test.js 的离线夹具:临时目录、配置对象、fetch 桩与依赖组装。
// 不是测试文件(不匹配 *.test.js),不会被 node --test 当用例跑。全部 SAMPLE,无真实凭据。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logicalDay } from '../src/clock.js'
import { PATHS } from '../src/crypto.js'
import { stateFile } from '../src/state.js'

// 2026-10-11 10:00 本地 —— 不在安静时段 20:00-23:00,也不在关机时刻 02:00 前后 30 分钟。
export const NOW = new Date(2026, 9, 11, 10, 0, 0)
export const DAY = logicalDay(NOW, 4)
export const ACCOUNT = { id: 'acct-1', name: '账号 1', cookie: 'MUSIC_U=SAMPLE_MUSIC_U_VALUE' }

export const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'netease-run-'))

export const configFor = (root) => ({
  cwd: root,
  accounts: [ACCOUNT],
  timeoutMs: 10000,
  requestIntervalMs: 3000,
  boundaryHour: 4,
  stateDir: path.join(root, 'data'),
  lockDir: path.join(root, 'logs'),
  webhookFile: path.join(root, 'secrets', 'wecom-webhook.txt'),
  busyPeers: [],
  maxAttempts: 3,
  quietStart: '20:00',
  quietEnd: '23:00',
  shutdownTime: '02:00',
  shutdownMarginMinutes: 30,
  minFreeMb: 800,
  dryRun: false,
})

/** fetch 桩:按 URL 片段分派;命中的回复带 throw 时就抛网络错。记录每次调用。 */
export function stubFetch(replies) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const hit = Object.entries(replies).find(([fragment]) => url.includes(fragment))
    const reply = hit ? hit[1] : {}
    if (reply.throw) throw new Error(reply.throw)
    return { ok: true, status: 200, text: async () => JSON.stringify(reply.body ?? {}) }
  }
  return { calls, fetchImpl }
}

export const countOf = (calls, fragment) => calls.filter((url) => url.includes(fragment)).length

/** 云贝两条查询都成功的回复;可整体覆盖。 */
export function okYunbei() {
  return {
    [PATHS.yunbeiSignedGet]: { body: { code: 200, data: { sign: true, yunbeiNum: 120 } } },
    [PATHS.yunbeiTodayGet]: { body: { code: 200, data: { yunbeiNum: 120 } } },
  }
}

/** 组装一次完整注入;config 已给,runOnce 不会去读 .env。 */
export function harness({ fetchImpl, root, config = configFor(root), ...extra }) {
  const sent = []
  const logs = []
  const sleeps = []
  const deps = {
    config,
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    freeMb: () => 99999,
    peerRunning: () => false,
    send: async (text) => {
      sent.push(text)
      return { ok: true }
    },
    log: (line) => {
      logs.push(line)
    },
    ...extra,
  }
  return { deps, sent, logs, sleeps }
}

export const readStateFile = (config) => JSON.parse(fs.readFileSync(stateFile(config.stateDir), 'utf8'))
