// 扫码登录:起 Console 跑 Login,从日志里抽 tool.lu 二维码链接并立刻回调,退出后自证拿到新 mid。
import { loadConfig } from './config.js'
import { runConsole } from './console-runner.js'
import { readCookie } from './api.js'

const LINK_RE = /https?:\/\/tool\.lu\/qrcode\/basic\.html\?text=\S+/

export function extractLink(stdout = '') {
    return LINK_RE.exec(String(stdout))?.[0]?.replace(/[",)\]]+$/, '') ?? null
}

export async function runLogin(deps = {}) {
    const config = deps.config ?? loadConfig()
    const read = deps.readCookieImpl ?? ((file) => readCookie(file))
    const before = read(config.cookiesFile)
    let link = null

    const result = await runConsole('Login', {}, {
        config,
        spawnImpl: deps.spawnImpl,
        timeoutMinutes: deps.timeoutMinutes,
        cwd: deps.cwd,
        onLine: (line) => {
            if (!link && line.includes('tool.lu/qrcode')) {
                link = extractLink(line) ?? line.trim()
                deps.onLink?.(link)
            }
            deps.onLine?.(line)
        }
    })

    if (!link) return { ok: false, link: null, mid: null, error: '没有从日志里找到二维码链接' }
    const after = read(config.cookiesFile)
    const mid = after?.mid ?? null
    if (result.code !== 0 || !mid || mid === before?.mid) {
        return { ok: false, link, mid, error: result.timedOut ? '登录超时,请重跑一次' : '没有拿到新的登录凭据' }
    }
    return { ok: true, link, mid, error: null }
}
