// 命令行入口。容器与宿主跑同一套:`node src/cli.js <子命令>`。
//   run      一次完整运行(守卫 + 领取 + 通知),调度用这个
//   seed     把导出的 cookie 灌进 profile(首次部署、cookie 失效后重灌)
//   inspect  只读:打开任务页,打印页面文本、可点按钮与豆数,不点
//   claim    跳过守卫直接点一次,调试用
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from './config.js'
import { launch, injectCookies, emulateMobile, sleep, shutdown } from './cdp.js'
import { claimInPage, listButtons, readPea, readText, screenshot, TASK_PAGE } from './page.js'
import { run, seed } from './run.js'

const CMD = process.argv[2] || 'run'
const accountArg = process.argv.find((one) => one.startsWith('--account='))?.split('=')[1]

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

async function withBrowser(config, account, fn) {
  if (!account) throw new Error('没有可用账号:先写 secrets/accounts.json')
  const { cdp, chrome } = await launch({ port: config.port, profile: account.profile, headless: config.headless })
  try {
    await cdp.send('Network.enable')
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await emulateMobile(cdp, { longitude: config.lng, latitude: config.lat })
    return await fn(cdp)
  } finally {
    await shutdown(cdp, chrome)
  }
}

async function inspect(config, account) {
  return withBrowser(config, account, async (cdp) => {
    // 调试用:允许临时注入 cookie,不影响 profile 的持久登录态之外的判断
    if (process.env.INJECT_COOKIE === '1' && fs.existsSync(account.cookieFile)) {
      const { injected, total } = await injectCookies(cdp, fs.readFileSync(account.cookieFile, 'utf8').trim())
      console.log(`[cookie] 注入 ${injected}/${total}`)
    }
    await cdp.send('Page.navigate', { url: TASK_PAGE })
    await sleep(7000)
    const text = await readText(cdp)
    const buttons = (await listButtons(cdp)) ?? []
    const pea = await readPea(cdp)
    const file = await screenshot(cdp, path.join(config.shotDir, `inspect-${stamp()}.png`))
    console.log('== 账号:', account.id, account.name)
    console.log('== 豆:', pea)
    console.log('== 可点按钮:', buttons.length, JSON.stringify(buttons.slice(0, 8)))
    console.log('== 页面文本 ==')
    console.log(text)
    console.log('== 截图:', file)
    return 0
  })
}

async function claim(config, account) {
  return withBrowser(config, account, async (cdp) => {
    const file = path.join(config.shotDir, `claim-${stamp()}.png`)
    const result = await claimInPage(cdp, {
      maxClicks: config.maxClicks,
      onShot: file,
      log: (event) => console.log('  ·', JSON.stringify(event)),
    })
    console.log('== 结论:', JSON.stringify({
      ok: result.ok, reason: result.reason, clicked: result.clicked,
      before: result.before, after: result.after, delta: result.delta,
    }))
    return result.ok ? 0 : 1
  })
}

async function main() {
  const config = loadConfig(process.cwd())
  const account = config.accounts.find((one) => one.id === accountArg) ?? config.accounts[0]

  if (CMD === 'run') {
    const result = await run({ config })
    console.log(result.text)
    return result.code
  }
  if (CMD === 'seed') {
    const result = await seed(process.cwd(), accountArg)
    console.log(result.text)
    return result.code
  }
  if (CMD === 'inspect') return inspect(config, account)
  if (CMD === 'claim') return claim(config, account)
  console.error(`用法: node src/cli.js <run|seed|inspect|claim> [--account=<id>]`)
  return 2
}

process.exitCode = await main()
