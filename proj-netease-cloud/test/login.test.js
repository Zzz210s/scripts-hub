// login 子命令:解析粘贴的 cookie、写进 .env(权限 600)、清当天熔断标记、只读自证。
// 刻意不读 stdin —— 容器里 `docker compose run` 会吞掉 stdin(踩过),所以只认参数与文件。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { clearCircuitFor, loginWithCookie, parseCookieInput, saveCookieToEnv } from '../src/login.js'

const MUSIC_U = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6'
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'netease-login-'))

test('parseCookieInput:整条 cURL、cookie 头、MUSIC_U=值、裸值都能取出', () => {
  const curl = `curl 'https://music.163.com/weapi/x' -H 'cookie: os=pc; MUSIC_U=${MUSIC_U}; __csrf=abc' --data '{}'`
  assert.deepEqual(parseCookieInput(curl), { ok: true, cookie: MUSIC_U })
  assert.deepEqual(parseCookieInput(`Cookie: MUSIC_U=${MUSIC_U}`), { ok: true, cookie: MUSIC_U })
  assert.deepEqual(parseCookieInput(`MUSIC_U=${MUSIC_U}`), { ok: true, cookie: MUSIC_U })
  assert.deepEqual(parseCookieInput(MUSIC_U), { ok: true, cookie: MUSIC_U })
});

test('parseCookieInput:空内容与明显不是 cookie 的值要拒绝,并说清原因', () => {
  assert.equal(parseCookieInput('').ok, false)
  assert.equal(parseCookieInput('   ').ok, false)
  const bad = parseCookieInput('hello world this is a note')
  assert.equal(bad.ok, false)
  assert.match(bad.error, /看起来不是 MUSIC_U 的值/)
});

test('saveCookieToEnv:只改目标行,保留其它键,权限 600', () => {
  const cwd = tmp()
  const file = path.join(cwd, '.env')
  fs.writeFileSync(file, 'ACCOUNT_1_MUSIC_U=old\nNETEASE_MAX_ATTEMPTS=2\nACCOUNT_2_MUSIC_U=other\n')
  const result = saveCookieToEnv({ cwd, cookie: MUSIC_U })
  assert.equal(result.ok, true)
  assert.equal(result.replaced, true)
  const body = fs.readFileSync(file, 'utf8')
  assert.match(body, new RegExp(`^ACCOUNT_1_MUSIC_U=${MUSIC_U}$`, 'm'))
  assert.match(body, /^NETEASE_MAX_ATTEMPTS=2$/m)
  assert.match(body, /^ACCOUNT_2_MUSIC_U=other$/m)
  const mode = fs.statSync(file).mode & 0o777
  if (process.platform === 'win32') {
    // Windows 上 chmod 基本无效:能断言的是「写的时候传了 600」,权限位本身不具可比性
    assert.ok(mode > 0)
  } else {
    assert.equal(mode, 0o600)
  }
});

test('saveCookieToEnv:.env 不存在或没有这一行时追加,不留多余空行', () => {
  const cwd = tmp()
  assert.equal(saveCookieToEnv({ cwd, cookie: MUSIC_U }).replaced, false)
  assert.match(fs.readFileSync(path.join(cwd, '.env'), 'utf8'), new RegExp(`ACCOUNT_1_MUSIC_U=${MUSIC_U}`))
  fs.writeFileSync(path.join(cwd, '.env'), 'NETEASE_MAX_ATTEMPTS=2\n\n\n')
  saveCookieToEnv({ cwd, cookie: MUSIC_U, account: 3 })
  const body = fs.readFileSync(path.join(cwd, '.env'), 'utf8')
  assert.match(body, /^NETEASE_MAX_ATTEMPTS=2$/m)
  assert.match(body, new RegExp(`^ACCOUNT_3_MUSIC_U=${MUSIC_U}$`, 'm'))
  assert.ok(!/\n\n\n/.test(body), '不应保留多余空行')
});

test('clearCircuitFor:当天熔断标记被清掉,其它字段不动', () => {
  const cwd = tmp()
  const day = '2026-10-27'
  fs.mkdirSync(path.join(cwd, 'data'), { recursive: true })
  fs.writeFileSync(path.join(cwd, 'data', 'state.json'), JSON.stringify({
    version: 1, updatedAt: '2026-10-27T00:00:00.000Z', lastRunDay: day, lastResult: 'failure', baseline: null,
    days: { [day]: { attempts: 1, ok: false, circuitBroken: true, circuitKind: 'auth', checkedAt: '2026-10-27T00:00:00.000Z' } },
  }))
  const result = clearCircuitFor({ cwd, now: new Date('2026-10-27T12:00:00+08:00') })
  assert.equal(result.cleared, true)
  const state = JSON.parse(fs.readFileSync(path.join(cwd, 'data', 'state.json'), 'utf8'))
  assert.equal(state.days[day].circuitBroken, false)
  assert.equal(state.days[day].circuitKind, null)
  assert.equal(state.days[day].attempts, 1, '尝试次数不该被顺手清掉')
  assert.equal(clearCircuitFor({ cwd, now: new Date('2026-10-27T13:00:00+08:00') }).cleared, false)
});

test('loginWithCookie:坏输入不落盘;好输入落盘并调用自证', async () => {
  const cwd = tmp()
  const bad = await loginWithCookie({ cwd, raw: 'nope' })
  assert.equal(bad.ok, false)
  assert.equal(bad.step, 'parse')
  assert.equal(fs.existsSync(path.join(cwd, '.env')), false)

  const calls = []
  const good = await loginWithCookie({
    cwd, raw: `MUSIC_U=${MUSIC_U}`, now: new Date('2026-10-27T12:00:00+08:00'),
    deps: { verify: async (input) => { calls.push(input); return { ok: true, state: '今天未签' } } },
  })
  assert.equal(good.ok, true)
  assert.equal(good.verified.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cookie, `MUSIC_U=${MUSIC_U}`)
  assert.match(fs.readFileSync(path.join(cwd, '.env'), 'utf8'), new RegExp(MUSIC_U))
});
