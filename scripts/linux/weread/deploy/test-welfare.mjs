// 临时自检:福利书币 / 阅读时长福利(周奖励)的接口直调 —— 不跑阅读会话。
// 跑法:
//   docker compose -f /srv/apps/automation/compose.yaml run --rm -T \
//     --entrypoint node weread-run /opt/deploy/test-welfare.mjs
import fs from 'node:fs'
import { claimIfAvailable } from '/opt/weread/src/welfare.js'
import { collectWeekly } from '/opt/weread/src/weekly.js'
import { ensureAppToken } from '/opt/weread/src/app-auth.js'

const appToken = JSON.parse(fs.readFileSync('/opt/weread/secrets/app-token.json', 'utf8'))
const curl = fs.readFileSync('/opt/weread/secrets/read-request.curl', 'utf8')
const bookId = /"b"\s*:\s*"([^"]+)"/.exec(curl)?.[1] ?? ''
console.log('bookId 解析:', bookId ? `${bookId.slice(0, 8)}…` : '(空)')

const token = await ensureAppToken({
    curlFile: '/opt/weread/secrets/read-request.curl',
    tokenFile: '/opt/weread/secrets/app-token.json',
    credentialsFile: '/opt/weread/secrets/app-credentials.json'
})
console.log('App 凭据:', token?.accessToken ? `可用(${token.reused ? '复用缓存' : '新换取'})` : `不可用(${token?.reason ?? '未知'})`)

const ctx = { token, bookId, chapterUid: 0 }   // 这些函数读的是 ctx.token(见 appHeaders)

try {
    const w = await claimIfAvailable(ctx)
    console.log('福利书币:', JSON.stringify(w).slice(0, 300))
} catch (e) {
    console.log('福利书币: 异常', e.message)
}

try {
    const wk = await collectWeekly(ctx)
    console.log('周奖励:', JSON.stringify(wk).slice(0, 400))
} catch (e) {
    console.log('周奖励: 异常', e.message)
}
