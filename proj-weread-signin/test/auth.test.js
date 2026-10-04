import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
    checkCredential, cookieToString, cookieToObject, describeCredential, ensureCredential,
    mergeSetCookie, parseCurl, renewCookie, updateCookieInCurl
} from '../src/auth.js'

const CURL = `curl --url 'https://weread.qq.com/web/book/read' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'content-type: application/json;charset=UTF-8' \\
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0) Chrome/154.0.0.0' \\
  -b 'wr_vid=547414326; wr_skey=oldkey; wr_rt=web%40OLD; wr_name=210%E7%9A%84' \\
  --data-raw '{"b":"ce032b305a9bc1ce0b0dd2a","rt":30}'`

const tmp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-auth-'))
    const file = path.join(dir, 'read-request.curl')
    fs.writeFileSync(file, CURL, 'utf8')
    return file
}

function jsonResponse(body, { status = 200, setCookie = [] } = {}) {
    return {
        status,
        headers: { getSetCookie: () => setCookie, get: () => setCookie.join(', ') },
        text: async () => JSON.stringify(body)
    }
}

test('parseCurl 取出 url / cookie / headers / body', () => {
    const parsed = parseCurl(CURL)
    assert.equal(parsed.url, 'https://weread.qq.com/web/book/read')
    assert.match(parsed.cookie, /wr_skey=oldkey/)
    assert.match(parsed.headers['user-agent'], /Chrome/)
    assert.match(parsed.body, /ce032b305a9bc1ce0b0dd2a/)
})

test('cookie 对象与字符串互转,mergeSetCookie 只合并持久字段', () => {
    const object = cookieToObject('a=1; b=2')
    assert.deepEqual(object, { a: '1', b: '2' })
    assert.equal(cookieToString({ a: '1', b: '2' }), 'a=1; b=2')
    const merged = mergeSetCookie('wr_skey=old; wr_rt=oldrt; wr_name=x', [
        'wr_skey=new; Expires=Thu, 01 Oct 2026 15:11:23 GMT; Max-Age=5400',
        'wr_rt=newrt; Max-Age=31104000',
        'irrelevant=1; Max-Age=10'
    ])
    assert.match(merged.cookie, /wr_skey=new/)
    assert.match(merged.cookie, /wr_rt=newrt/)
    assert.match(merged.cookie, /wr_name=x/)
    assert.ok(!merged.cookie.includes('irrelevant'))
    assert.deepEqual(merged.changed.sort(), ['wr_rt', 'wr_skey'])
})

test('updateCookieInCurl 只替换 cookie 段,其余原样保留', () => {
    const next = updateCookieInCurl(CURL, 'wr_vid=1; wr_skey=zzz')
    assert.match(next, /-b 'wr_vid=1; wr_skey=zzz'/)
    assert.match(next, /--data-raw '\{"b":"ce032b305a9bc1ce0b0dd2a","rt":30\}'/)
})

test('checkCredential:能读到 userVid 即有效', async () => {
    const file = tmp()
    const ok = await checkCredential({ curlFile: file, fetchImpl: async () => jsonResponse({ userVid: 547414326 }) })
    assert.equal(ok.ok, true)
    const bad = await checkCredential({ curlFile: file, fetchImpl: async () => jsonResponse({ errCode: -2012, errMsg: '登录超时' }, { status: 200 }) })
    assert.equal(bad.ok, false)
    assert.match(bad.reason, /-2012/)
})

test('renewCookie:成功后把新凭证写回文件,并返回更新的字段', async () => {
    const file = tmp()
    const result = await renewCookie({
        curlFile: file,
        fetchImpl: async () => jsonResponse({ succ: 1 }, { setCookie: ['wr_skey=newkey; Max-Age=5400', 'wr_rt=web%40NEW; Max-Age=31104000'] })
    })
    assert.equal(result.ok, true)
    assert.deepEqual(result.changed.sort(), ['wr_rt', 'wr_skey'])
    const written = fs.readFileSync(file, 'utf8')
    assert.match(written, /wr_skey=newkey/)
    assert.match(written, /wr_rt=web%40NEW/)
    assert.ok(!fs.existsSync(`${file}.tmp`))
})

test('renewCookie:ql=true 鉴权失败时会继续试下一种形式', async () => {
    const file = tmp()
    const seen = []
    const result = await renewCookie({
        curlFile: file,
        fetchImpl: async (url, options) => {
            const payload = JSON.parse(options.body)
            seen.push(payload.ql)
            if (payload.ql === false) return jsonResponse({ errCode: -2013, errMsg: '鉴权失败' })
            return jsonResponse({ succ: 1 }, { setCookie: ['wr_skey=fromSecond; Max-Age=5400'] })
        }
    })
    assert.deepEqual(seen, [false, true])
    assert.equal(result.ok, true)
    assert.match(fs.readFileSync(file, 'utf8'), /wr_skey=fromSecond/)
})

test('renewCookie:全部失败时不动文件', async () => {
    const file = tmp()
    const before = fs.readFileSync(file, 'utf8')
    const result = await renewCookie({ curlFile: file, fetchImpl: async () => jsonResponse({ errCode: -2013 }) })
    assert.equal(result.ok, false)
    assert.equal(fs.readFileSync(file, 'utf8'), before)
})

test('ensureCredential:有效时不续期;失效时先续期再体检', async () => {
    const file = tmp()
    let userCalls = 0
    const healthy = await ensureCredential({
        curlFile: file,
        fetchImpl: async url => (String(url).includes('/web/user') ? jsonResponse({ userVid: 1 }) : jsonResponse({ succ: 1 }))
    })
    assert.equal(healthy.ok, true)
    assert.equal(healthy.renewed, false)

    const recovered = await ensureCredential({
        curlFile: file,
        fetchImpl: async url => {
            if (String(url).includes('/web/user')) {
                userCalls += 1
                return userCalls === 1 ? jsonResponse({ errCode: -2012 }, { status: 401 }) : jsonResponse({ userVid: 1 })
            }
            return jsonResponse({ succ: 1 }, { setCookie: ['wr_skey=fresh; Max-Age=5400'] })
        }
    })
    assert.equal(recovered.ok, true)
    assert.equal(recovered.renewed, true)
    assert.match(describeCredential(recovered), /续期成功/)
    assert.match(fs.readFileSync(file, 'utf8'), /wr_skey=fresh/)
})

test('describeCredential 对失效给出原因与尝试记录', () => {
    const text = describeCredential({ ok: false, check: { reason: 'HTTP 401 errCode=-2012' }, firstFailure: 'HTTP 401', tried: ['ql=false:HTTP 401'] })
    assert.match(text, /凭据失效/)
    assert.match(text, /-2012/)
    assert.match(text, /ql=false/)
})
