// run*.test.js 共享的夹具(不是测试文件,不被 test/*.test.js 匹配)。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from '../src/config.js'

export const NOW = new Date('2026-10-11T10:00:00')
export const CRED = { cookie: 'cookie', mid: '123456', csrf: 'csrf' }
export const ANNUAL = { code: 0, data: { isLogin: true, vipStatus: 1, vipType: 2, money: 128, wallet: { coupon_balance: 5 } } }
// 2026-10-11 真机实证:login/watch 已完成,share 未完成,coins 已满 50
export const REWARD = { code: 0, data: { login: true, watch: true, coins: 50, share: false } }

export function setup(env = {}, state = null) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-run-'))
    const config = loadConfig({ BILIBILI_DIR: dir, ...env })
    if (state) {
        fs.mkdirSync(path.dirname(config.stateFile), { recursive: true })
        fs.writeFileSync(config.stateFile, JSON.stringify(state))
    }
    return { dir, config }
}

export function makeDeps(overrides = {}) {
    const calls = { sent: [], fetch: [], spawn: [], lock: 0 }
    const base = {
        calls,
        log: () => {},
        readCookie: () => CRED,
        peerRunning: () => false,
        freeMb: () => 4096,
        fetchNav: async () => { calls.fetch.push('nav'); return { ok: true, data: ANNUAL } },
        fetchVoucher: async () => { calls.fetch.push('voucher'); return { ok: true, data: { code: 0, data: { list: [{ type: 1, state: 1, next_receive_days: 31 }] } } } },
        receiveVoucher: async () => { calls.fetch.push('receive'); return { ok: true } },
        fetchCoin: async () => { calls.fetch.push('coin'); return { ok: true, data: { money: 128 } } },
        fetchExpReward: async () => { calls.fetch.push('exp'); return { ok: true, data: REWARD } },
        fetchFollowingsTotal: async () => { calls.fetch.push('followings'); return { ok: true, total: 42 } },
        runConsole: async (tasks, env) => { calls.spawn.push({ tasks, env }); return { code: 0, stdout: '', stderr: '', timedOut: false } },
        send: async (text) => { calls.sent.push(text); return { ok: true } }
    }
    return { ...base, ...overrides, calls: overrides.calls ?? calls }
}
