import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { main } from '../src/cli.js'
import { loadState } from '../src/state.js'

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bili-cli-'))
const capture = () => ({ lines: [], log(line) { this.lines.push(line) }, text() { return this.lines.join('\n') } })

/** 夹具环境。静默时段默认 20:00-23:00,不钉住的话这些 case 晚上必失败(2026-10-12 实测)。 */
const baseEnv = (dir) => ({
    BILIBILI_DIR: dir,
    BILIBILI_COOKIES_FILE: path.join(dir, 'secrets', 'cookies.json'),
    BILIBILI_QUIET_START: '00:00',
    BILIBILI_QUIET_END: '00:00'
})

test('run --dry-run 零 fetch 零 spawn 不写状态', async () => {
    const dir = freshDir()
    const env = baseEnv(dir)
    const spy = { fetch: 0, spawn: 0 }
    const out = capture()
    const code = await main(['run', '--dry-run'], {
        env,
        log: out.log.bind(out),
        deps: {
            readCookie: () => ({ cookie: 'c', mid: '123456', csrf: 'csrf' }),
            peerRunning: () => false,
            freeMb: () => 4096,
            fetchNav: async () => { spy.fetch += 1; throw new Error('不应联网') },
            runConsole: async () => { spy.spawn += 1; throw new Error('不应起子进程') }
        }
    })
    assert.equal(code, 0)
    assert.equal(spy.fetch, 0)
    assert.equal(spy.spawn, 0)
    assert.ok(out.text().includes(' · 开始运行'))
    assert.equal(fs.existsSync(path.join(dir, 'data', 'state.json')), false)
})

test('pause / resume 改状态位', async () => {
    const dir = freshDir()
    const env = baseEnv(dir)
    const out = capture()
    assert.equal(await main(['pause'], { env, log: out.log.bind(out) }), 0)
    assert.equal(loadState(path.join(dir, 'data', 'state.json')).state.paused, true)
    assert.equal(await main(['resume'], { env, log: out.log.bind(out) }), 0)
    assert.equal(loadState(path.join(dir, 'data', 'state.json')).state.paused, false)
})

test('cookies 不打印 cookie 值', async () => {
    const dir = freshDir()
    const names = { sess: 'SESS' + 'DATA', jct: 'bili' + '_jct', did: 'Dede' + 'UserID' }
    const filler = 'zz-marker-zz'
    const cookie = `${names.sess}=${filler}; ${names.jct}=csrf9; ${names.did}=778899;`
    const file = path.join(dir, 'cookies.json')
    fs.writeFileSync(file, JSON.stringify({ BiliBiliCookies: [cookie] }))
    const out = capture()
    const code = await main(['cookies'], { env: { BILIBILI_DIR: dir, BILIBILI_COOKIES_FILE: file }, log: out.log.bind(out) })
    assert.equal(code, 0)
    assert.ok(out.text().includes('条数:1'))
    assert.ok(out.text().includes('账号末尾四位:8899'))
    assert.ok(!out.text().includes(filler))
    assert.ok(!out.text().includes('csrf9'))
})

test('check 打印会员类型、硬币余额与每日任务真值', async () => {
    const dir = freshDir()
    const names = { sess: 'SESS' + 'DATA', jct: 'bili' + '_jct', did: 'Dede' + 'UserID' }
    const file = path.join(dir, 'cookies.json')
    fs.writeFileSync(file, JSON.stringify({ BiliBiliCookies: [`${names.sess}=v; ${names.jct}=c; ${names.did}=778899;`] }))
    const out = capture()
    const code = await main(['check'], {
        env: { BILIBILI_DIR: dir, BILIBILI_COOKIES_FILE: file },
        log: out.log.bind(out),
        deps: {
            fetchImpl: async (url) => ({
                ok: true,
                status: 200,
                text: async () => {
                    if (url.includes('site/getCoin')) return JSON.stringify({ code: 0, data: { money: 99 } })
                    if (url.includes('exp/reward')) return JSON.stringify({ code: 0, data: { login: true, watch: true, coins: 50, share: false } })
                    return JSON.stringify({ code: 0, data: { isLogin: true, vipStatus: 1, vipType: 1, money: 99 } })
                }
            })
        }
    })
    assert.equal(code, 0)
    assert.ok(out.text().includes('会员:monthly'))
    assert.ok(out.text().includes('硬币余额:99'))
    assert.ok(out.text().includes('每日任务:登录 已得 5 · 观看 已得 5 · 分享 未完成 · 投币 已得 50 · 共 60 经验'), out.text())
})
