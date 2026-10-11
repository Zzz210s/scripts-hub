// 只读探针:查 nav / privilege my / 每日任务经验 三个接口的真实返回,用于修正消息文案。
// 不写任何文件、不发通知、不改账号状态(GET only)。cookie 只从文件读,不打印。
import fs from 'node:fs'

const FILE = process.env.COOKIES_FILE || '/opt/bili/secrets/cookies.json'

const text = fs.readFileSync(FILE, 'utf8')
// 上游是 Newtonsoft 风格(带尾逗号)
let parsed
try { parsed = JSON.parse(text) } catch {
    let out = '', inStr = false, esc = false
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (inStr) { out += ch; if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
        if (ch === '"') { inStr = true; out += ch; continue }
        if (ch === ',') { let j = i + 1; while (j < text.length && /\s/.test(text[j])) j++; if (text[j] === ']' || text[j] === '}') continue }
        out += ch
    }
    parsed = JSON.parse(out)
}
const cookie = String(parsed.BiliBiliCookies[0])
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const get = async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: cookie } })
    const body = await res.text()
    try { return { status: res.status, json: JSON.parse(body) } } catch { return { status: res.status, raw: body.slice(0, 200) } }
}

const nav = await get('https://api.bilibili.com/x/web-interface/nav')
if (nav.json) {
    const d = nav.json.data ?? {}
    console.log('=== nav')
    console.log('code:', nav.json.code, '| isLogin:', d.isLogin, '| vipStatus:', d.vipStatus, '| vipType:', d.vipType, '| level:', d.level_info?.current_level)
    console.log('wallet:', JSON.stringify(d.wallet ?? null))
    console.log('vipLabel:', JSON.stringify(d.vip_label ?? null))
} else console.log('nav 失败:', nav.status, nav.raw)

const my = await get('https://api.bilibili.com/x/vip/privilege/my')
console.log('=== vip/privilege/my')
console.log('code:', my.json?.code, '| msg:', my.json?.message)
console.log('data:', JSON.stringify(my.json?.data ?? my.raw ?? null))

const exp = await get('https://api.bilibili.com/x/member/web/exp/reward')
console.log('=== member/web/exp/reward')
console.log('code:', exp.json?.code, '| msg:', exp.json?.message)
console.log('data:', JSON.stringify(exp.json?.data ?? exp.raw ?? null))
