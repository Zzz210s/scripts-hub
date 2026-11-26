// 一次运行:守卫 → 抢锁 → 每个账号开一次浏览器 → 页面里点领取 → 记账 → 通知。
// 一个账号失败不影响另一个;退出码只反映「有没有硬失败」,跳过一律 0。
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from './config.js'
import { guard } from './guards.js'
import { acquireLock, releaseLock } from './lock.js'
import { logicalDay, formatLocal } from './clock.js'
import { claimedToday, loadState, recordRun, saveState } from './state.js'
import { sendWecom } from './notify.js'
import { claimInPage } from './page.js'
import { emulateMobile, injectCookies, launch, shutdown } from './cdp.js'

const logLine = (file, text) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `[${formatLocal()}] ${text}\n`, 'utf8')
  } catch { /* 日志写不动不该让任务失败 */ }
}

/** 单账号:起浏览器 → 进页面 → 点 → 收。返回 {ok, reason, before, after, delta, clicks, captcha}。 */
async function runAccount(config, account, day, out) {
  const shot = path.join(config.shotDir, `claim-${day}-${account.id}.png`)
  const port = config.port
  const { cdp, chrome } = await launch({ port, profile: account.profile, headless: config.headless })
  try {
    await cdp.send('Network.enable')
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await emulateMobile(cdp, { longitude: config.lng, latitude: config.lat })
    const cookieText = fs.existsSync(account.cookieFile) ? fs.readFileSync(account.cookieFile, 'utf8').trim() : ''
    const result = await claimInPage(cdp, {
      maxClicks: config.maxClicks,
      onShot: shot,
      cookieText,
      log: (event) => logLine(out.log, `${account.id} ${JSON.stringify(event)}`),
    })
    return { ...result, shot }
  } finally {
    await shutdown(cdp, chrome)
  }
}

export async function run(options = {}) {
  const config = options.config ?? loadConfig(process.cwd())
  const now = options.now ?? new Date()
  const day = logicalDay(now, config.boundaryHour)
  const out = { log: path.join(config.stateDir, 'runner.log'), lines: [] }

  if (!config.accounts.length) {
    const text = '淘宝闪购:没有配置账号(secrets/accounts.json 或 ACCOUNT_n_COOKIE_FILE)'
    logLine(out.log, text)
    return { code: 1, text, skipped: false }
  }

  const { state } = loadState(config.stateDir)
  const verdict = guard({ config, state, day, now, claimedToday })
  if (verdict.skip) {
    logLine(out.log, `跳过:${verdict.reason}`)
    return { code: 0, text: `跳过:${verdict.reason}`, skipped: true }
  }

  fs.mkdirSync(config.stateDir, { recursive: true })
  const lock = acquireLock(config.stateDir, { now })
  if (!lock.ok) {
    logLine(out.log, `跳过:另一个实例正在跑(${JSON.stringify(lock.holder)})`)
    return { code: 0, text: '跳过:另一个实例正在跑', skipped: true }
  }

  const lines = []
  let hardFail = 0
  try {
    for (const account of verdict.accounts) {
      if (!fs.existsSync(account.profile)) {
        const hint = `${account.name}:profile 不存在(${account.profile})—— 先跑 seed 把 cookie 灌进去`
        lines.push(hint)
        logLine(out.log, hint)
        hardFail += 1
        continue
      }
      let result = null
      try {
        result = await runAccount(config, account, day, out)
      } catch (error) {
        lines.push(`${account.name}:运行出错 ${error?.message ?? error}`)
        logLine(out.log, `${account.id} 出错:${error?.stack ?? error}`)
        hardFail += 1
        continue
      }

      const note = result.reason ?? (result.clicked ? 'claimed' : 'nothing-to-do')
      recordRun(state, {
        day, id: account.id, clicks: result.clicked ?? 0,
        before: result.before, after: result.after, delta: result.delta, note,
      })
      saveState(config.stateDir, state)
      logLine(out.log, `${account.id} 结果 ${JSON.stringify({ ok: result.ok, reason: result.reason, clicked: result.clicked, before: result.before, after: result.after, delta: result.delta })}`)

      if (result.reason === 'captcha') {
        lines.push(`${account.name}:撞上人机验证,已停手(豆 ${result.before ?? '?'})`)
        hardFail += 1
      } else if (!result.ok && result.reason !== 'nothing-to-do') {
        lines.push(`${account.name}:${result.reason ?? '未完成'}`)
        hardFail += 1
      } else if (result.delta > 0) {
        lines.push(`${account.name}:+${result.delta} 豆(${result.before} → ${result.after})`)
      } else {
        lines.push(`${account.name}:今天没有可领的任务(豆 ${result.before ?? '?'})`)
      }
    }
  } finally {
    releaseLock(config.stateDir)
  }

  const text = `淘宝闪购吃货豆 ${day}\n${lines.join('\n')}`
  // 没有任务的日子不发消息:每天一条「没任务」会把通道刷成噪音,真出事时反而被忽略。
  const worthNotifying = hardFail > 0 || lines.some((line) => line.includes('+'))
  if (worthNotifying && !config.dryRun) {
    const sent = await sendWecom(text, { webhookFile: config.webhookFile })
    logLine(out.log, `通知 ${sent.ok ? '已发' : `失败:${sent.error}`}`)
  }
  return { code: hardFail ? 1 : 0, text, skipped: false, hardFail }
}

/** seed:把导出的 cookie 灌进该账号的 profile,并验证页面能读到豆数。之后 run 不再碰 cookie 文件。 */
export async function seed(cwd = process.cwd(), accountId) {
  const config = loadConfig(cwd)
  const account = config.accounts.find((one) => one.id === accountId) ?? config.accounts[0]
  if (!account) return { code: 1, text: '没有配置账号' }
  if (!fs.existsSync(account.cookieFile)) return { code: 1, text: `cookie 文件不存在:${account.cookieFile}` }
  const jar = fs.readFileSync(account.cookieFile, 'utf8').trim()
  const { cdp, chrome } = await launch({ port: config.port, profile: account.profile, headless: config.headless })
  try {
    await cdp.send('Network.enable')
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    const { injected, total } = await injectCookies(cdp, jar)
    await emulateMobile(cdp, { longitude: config.lng, latitude: config.lat })
    await cdp.send('Page.navigate', { url: 'https://h5.ele.me/svip/task-list' })
    await new Promise((resolve) => setTimeout(resolve, 6000))
    const { readText, readPea } = await import('./page.js')
    const pea = await readPea(cdp)
    const text = await readText(cdp)
    const ok = typeof pea === 'number' && !/未登录/.test(text)
    return {
      code: ok ? 0 : 1,
      text: `注入 ${injected}/${total} · 豆 ${pea ?? '?'} · ${ok ? 'profile 可用' : '仍是未登录,重新导 cookie'} · ${account.profile}`,
    }
  } finally {
    await shutdown(cdp, chrome)
  }
}
