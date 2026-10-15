// run.test.js 的离线夹具:临时目录、配置对象、fetch 桩与依赖组装。
// 不是测试文件(不匹配 *.test.js),不会被 node --test 当用例跑。全部 SAMPLE,无真实凭据。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logicalDay } from '../src/clock.js'
import { DEFAULTS } from '../src/config.js'
import { PATHS } from '../src/crypto.js'
import { stateFile } from '../src/state.js'

// 2026-10-11 10:00 本地 —— 不在安静时段 20:00-23:00,也不在关机时刻 02:00 前后 30 分钟。
export const NOW = new Date(2026, 9, 11, 10, 0, 0)
export const DAY = logicalDay(NOW, 4)
export const ACCOUNT = { id: 'acct-1', name: '账号 1', cookie: 'MUSIC_U=SAMPLE_MUSIC_U_VALUE' }

export const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'netease-run-'))

// 可调阈值全部从 src/config.js 的 DEFAULTS 展开,夹具不另抄一份 —— 守卫阈值改真源时,
// 夹具跟着变;抄成字面量的话夹具漂移不会被任何测试抓住(评审轮次 2)。
// 下面只覆盖与临时目录相关的路径,以及账号列表。
export const configFor = (root) => ({
  ...DEFAULTS,
  cwd: root,
  accounts: [ACCOUNT],
  stateDir: path.join(root, 'data'),
  lockDir: path.join(root, 'logs'),
  webhookFile: path.join(root, 'secrets', 'wecom-webhook.txt'),
  busyPeers: [],
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
    const status = reply.status ?? 200
    return { ok: status < 400, status, text: async () => JSON.stringify(reply.body ?? {}) }
  }
  return { calls, fetchImpl }
}

export const countOf = (calls, fragment) => calls.filter((url) => url.includes(fragment)).length

/** 云贝两条查询都成功的回复(真机形状:days/shells 与 shells);可整体覆盖。 */
export function okYunbei() {
  return {
    [PATHS.yunbeiSignedGet]: { body: { code: 200, data: { days: 4, shells: 2 } } },
    [PATHS.yunbeiTodayGet]: { body: { code: 200, data: { shells: 130 } } },
  }
}

/** 成长值 + 逐日记录两条只读回复(真机形状)。 */
export function okVipReads({ point = 7527, score = 3 } = {}) {
  return {
    [PATHS.vipGrowthPoint]: { body: { code: 200, data: { userLevel: { level: 4, growthPoint: point, yesterdayPoint: 6 } } } },
    [PATHS.vipSignInfo]: { body: { code: 200, data: [{ timeStr: '2026-10-11', today: true, score }] } },
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
