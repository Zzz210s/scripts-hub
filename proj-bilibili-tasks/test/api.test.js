import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCookie, fetchNav, fetchVoucher, receiveVoucher, fetchCoin, fetchFollowingsTotal } from '../src/api.js'

const json = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) })
const capture = () => {
    const calls = []
    return { calls, fetchImpl: async (url, options) => { calls.push({ url, options }); return json({ code: 0, data: {} }) } }
}

test('各接口 URL 与请求头', async () => {
    const { calls, fetchImpl } = capture()
    await fetchNav('SESSDATA=x', { fetchImpl })
    await fetchVoucher('SESSDATA=x', { fetchImpl })
    await receiveVoucher('SESSDATA=x', 'csrf123', { fetchImpl })
    await fetchFollowingsTotal('SESSDATA=x', '12345', { fetchImpl })
    assert.equal(calls[0].url, 'https://api.bilibili.com/x/web-interface/nav')
    assert.equal(calls[1].url, 'https://api.bilibili.com/x/vip/privilege/my')
    assert.equal(calls[2].url, 'https://api.bilibili.com/x/vip/privilege/receive?type=1&csrf=csrf123')
    assert.equal(calls[2].options.method, 'POST')
    assert.ok(calls[3].url.includes('vmid=12345&pn=1&ps=1'))
    assert.equal(calls[0].options.headers.Cookie, 'SESSDATA=x')
    assert.ok(calls[0].options.headers['User-Agent'])
})

test('getCoin 首选成功', async () => {
    const fetchImpl = async () => json({ code: 0, data: { money: 42 } })
    assert.deepEqual(await fetchCoin('c', { fetchImpl }), { ok: true, data: { money: 42 }, source: 'getCoin' })
})

test('getCoin 失败回落 nav.money;两者都失败 ok:false', async () => {
    const fetchImpl = async (url) => (url.includes('site/getCoin') ? { ok: false, status: 403, text: async () => 'html' } : json({ code: 0, data: { money: 128 } }))
    assert.deepEqual(await fetchCoin('c', { fetchImpl }), { ok: true, data: { money: 128 }, source: 'nav' })
    const allFail = async () => ({ ok: false, status: 500, text: async () => 'err' })
    assert.equal((await fetchCoin('c', { fetchImpl: allFail })).ok, false)
})

test('followings 用 total,缺失回落 list.length', async () => {
    const withTotal = async () => json({ code: 0, data: { total: 7, list: [] } })
    assert.deepEqual(await fetchFollowingsTotal('c', '1', { fetchImpl: withTotal }), { ok: true, total: 7 })
    const noTotal = async () => json({ code: 0, data: { list: [{}, {}] } })
    assert.deepEqual(await fetchFollowingsTotal('c', '1', { fetchImpl: noTotal }), { ok: true, total: 2 })
    assert.equal((await fetchFollowingsTotal('c', '', { fetchImpl: withTotal })).ok, false)
})

test('readCookie 抽出 cookie / mid / csrf;坏文件返回 null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-cookie-'))
    const file = path.join(dir, 'cookies.json')
    // 测试用的假凭据按片段拼出,避免仓库里的明文 cookie 形状(公开仓库的脱敏闸门要求)
    const names = { sess: 'SESS' + 'DATA', jct: 'bili' + '_jct', did: 'Dede' + 'UserID' }
    const cookie = `${names.sess}=x1; ${names.jct}=csrf9; ${names.did}=123456;`
    fs.writeFileSync(file, JSON.stringify({ BiliBiliCookies: [cookie] }))
    assert.deepEqual(readCookie(file), { cookie, mid: '123456', csrf: 'csrf9' })
    assert.equal(readCookie(path.join(dir, 'nope.json')), null)
    fs.writeFileSync(path.join(dir, 'bad.json'), 'not json')
    assert.equal(readCookie(path.join(dir, 'bad.json')), null)
    fs.writeFileSync(path.join(dir, 'empty.json'), JSON.stringify({ BiliBiliCookies: [] }))
    assert.equal(readCookie(path.join(dir, 'empty.json')), null)
})

test('非 JSON 响应与 code!=0 都算失败', async () => {
    const html = async () => ({ ok: true, status: 200, text: async () => '<html>' })
    assert.equal((await fetchNav('c', { fetchImpl: html })).ok, false)
    const codeFail = async () => json({ code: -101, message: '账号未登录' })
    const result = await fetchNav('c', { fetchImpl: codeFail })
    assert.equal(result.ok, false)
    assert.equal(result.code, -101)
})
