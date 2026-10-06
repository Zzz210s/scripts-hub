// 引擎:以子进程方式跑上游 epic-games.js(顶层脚本,没有导出的 API)。
// 无人值守跑法:NOTIFY 置空(不用上游的 apprise)、NOWAIT=1(未登录立刻退出而不是等人)、
// EG_EMAIL / EG_PASSWORD 清空(本项目不存密码,只用持久化浏览器 profile)。
// 结果由上游写进 vendor/free-games-claimer/data/epic-games.json,这里只负责读回来。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { readJsonSafe } from './atomic.js'

export function engineEnv(config, env = {}) {
    return {
        // 必须继承父进程环境:`spawn(..., { env })` 是**整体替换**而不是合并,
        // 不给它 process.env 就会丢掉 PATH、HOME、PLAYWRIGHT_BROWSERS_PATH 等 ——
        // 2026-10-06 实测后果:patchright 找不到浏览器,引擎直接报
        // `Executable doesn't exist at /root/.cache/ms-playwright/chromium-1243/...`,
        // 而浏览器其实装在包目录里(`PLAYWRIGHT_BROWSERS_PATH=0`)。
        // 下面这些显式覆盖必须排在后面,才能盖掉外面可能存在的同名变量。
        ...process.env,
        NOWAIT: '1',
        NOTIFY: '',
        NOTIFY_TITLE: '',
        EG_EMAIL: '',
        EG_PASSWORD: '',
        EG_OTPKEY: '',
        EG_MOBILE: '0',
        SHOW: '1',
        DRYRUN: '0',
        BROWSER_DIR: config.browserDir,
        ...env
    }
}

/** 跑一次引擎;超时就杀掉整棵进程树。返回 { code, stdout };启动失败返回 code:-1。 */
export function runEpicEngine({ config, env = {}, spawnImpl = spawn, timeoutMs = (config.engineTimeoutMinutes ?? 30) * 60000, log } = {}) {
    if (!fs.existsSync(config.engineScript)) {
        return Promise.resolve({ code: -1, stdout: '', error: `引擎不存在:${config.engineScript}` })
    }
    return new Promise((resolve) => {
        const child = spawnImpl(process.execPath, [config.engineScript], { cwd: config.vendorDir, env: engineEnv(config, env), windowsHide: false })
        let output = ''
        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            try {
                child.kill('SIGKILL')
            } catch { /* 已经退出 */ }
        }, timeoutMs)
        const collect = (chunk) => {
            output += chunk.toString()
            log?.(chunk.toString())
        }
        child.stdout?.on('data', collect)
        child.stderr?.on('data', collect)
        child.on('error', (error) => {
            clearTimeout(timer)
            resolve({ code: -1, stdout: output, error: error.message })
        })
        child.on('close', (code) => {
            clearTimeout(timer)
            resolve({ code: timedOut ? -1 : (code ?? -1), stdout: output, error: timedOut ? `引擎超过 ${timeoutMs / 60000} 分钟未结束,已强杀` : undefined })
        })
    })
}

/** 读上游写的 lowdb 文件;没有就返回空对象。 */
export function readVendorDb(config) {
    return readJsonSafe(config.vendorDbFile, {}).value ?? {}
}
