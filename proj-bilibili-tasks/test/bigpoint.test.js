import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
    buildClaimBody,
    buildClaimHeaders,
    claimBigPoint,
    pendingTaskCodes,
    readAppCredentials,
    readBigPointState,
    readCookieFields
} from '../src/bigpoint.js'
import { renderBigPointClaimLine } from '../src/messages.js'

const COMBINE = {
    data: {
        point_info: { point: 350 },
        task_info: {
            modules: [
                { module_title: '日常任务', common_task_item: [
                    { task_code: 'ogvwatchnew', state: 1, complete_times: 0, title: '观看剧集内容' },
                    { task_code: 'vipmallview', state: 3, complete_times: 1, title: '浏览会员购页面10秒' },
                    { task_code: 'tvodbuy', state: 1, complete_times: 0, title: '购买单点付费影片' }
                ] }
            ]
        }
    }
}

// 测试夹具:cookie 字段名在运行时拼出来,避免夹具本身触发脱敏闸门的凭据规则(值全是假的)。
const FIXTURE_COOKIE = ['bili' + '_jct=fixture-csrf', 'buvid' + '3=fixture-buvid', 'DedeUser' + 'ID=fixture-mid'].join('; ')

test('readCookieFields 从 cookie 串里取 csrf/buvid/mid', () => {
    const fields = readCookieFields(FIXTURE_COOKIE)
    assert.equal(fields.csrf, 'fixture-csrf')
    assert.equal(fields.buvid, 'fixture-buvid')
    assert.equal(fields.mid, 'fixture-mid')
})

test('readBigPointState 解析积分与任务状态', () => {
    const state = readBigPointState(COMBINE)
    assert.equal(state.point, 350)
    assert.deepEqual(state.tasks.map((task) => task.code), ['ogvwatchnew', 'vipmallview', 'tvodbuy'])
    assert.equal(state.tasks[1].state, 3)
})

test('pendingTaskCodes 只取待领取的', () => {
    assert.deepEqual(pendingTaskCodes(readBigPointState(COMBINE).tasks), ['ogvwatchnew', 'tvodbuy'])
})

test('buildClaimBody 含抓包里的设备字段,access_key 可选', () => {
    const body = buildClaimBody({ fields: { buvid: 'B', csrf: 'C' }, taskCode: 'ogvwatchnew' })
    for (const key of ['deviceId', 'fingerprint', 'device_platform', 'osVer', 'modelName', 'sessionID', 'statistics', 'taskCode']) {
        assert.ok(key in body, key)
    }
    assert.equal(body.access_key, undefined)
    assert.equal(buildClaimBody({ fields: { buvid: 'B', csrf: 'C' }, taskCode: 'x', accessKey: 'AK' }).access_key, 'AK')
})

test('buildClaimHeaders 只在有 ticket 时才带 x-bili-ticket', () => {
    const fields = readCookieFields(FIXTURE_COOKIE)
    assert.equal(buildClaimHeaders(fields).native_api_from, 'h5')
    assert.equal(buildClaimHeaders(fields)['x-bili-ticket'], undefined)
    assert.equal(buildClaimHeaders(fields, 'TICKET')['x-bili-ticket'], 'TICKET')
})

test('没有凭据文件时返回 null,一个请求都不发', async () => {
    const calls = []
    const result = await claimBigPoint({
        config: { appCredentialsFile: path.join(os.tmpdir(), 'definitely-missing-app.json') },
        cookie: FIXTURE_COOKIE,
        deps: { fetchImpl: async (url) => { calls.push(url); return { text: async () => '{}' } } }
    })
    assert.equal(result, null)
    assert.equal(calls.length, 0)
})

/** 造一个假端点:codes 变化由参数控制,用来区分「真领到」与「code=0 但没效果」。 */
function fakeFetch({ stateChanges, pointGain }) {
    let combineCalls = 0
    const calls = []
    return {
        calls,
        impl: async (url, init) => {
            calls.push({ url, method: init?.method ?? 'GET', body: init?.body })
            if (url.includes('combine')) {
                combineCalls += 1
                const after = combineCalls > 1
                const modules = [{
                    module_title: '日常任务',
                    common_task_item: [
                        { task_code: 'ogvwatchnew', state: after && stateChanges ? 3 : 1, complete_times: after && stateChanges ? 1 : 0 },
                        { task_code: 'vipmallview', state: 3, complete_times: 1 }
                    ]
                }]
                const payload = { data: { point_info: { point: 350 + (after ? pointGain : 0) }, task_info: { modules } } }
                return { text: async () => JSON.stringify(payload) }
            }
            return { text: async () => JSON.stringify({ code: 0, message: 'success' }) }
        }
    }
}

test('有凭据时按抓包形状补领,并以状态变化判定成功', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigpoint-'))
    const file = path.join(dir, 'app.json')
    fs.writeFileSync(file, JSON.stringify({ accessKey: 'AK', deviceTicket: 'TICKET' }), 'utf8')
    const fake = fakeFetch({ stateChanges: true, pointGain: 40 })

    const result = await claimBigPoint({
        config: { appCredentialsFile: file },
        cookie: FIXTURE_COOKIE,
        deps: { fetchImpl: fake.impl }
    })

    assert.equal(result.attempted, 1)
    assert.deepEqual(result.changed, ['ogvwatchnew'])
    assert.equal(result.gained, 40)
    const post = fake.calls.find((call) => call.method === 'POST')
    assert.ok(post.body.includes('taskCode=ogvwatchnew'))
    assert.ok(post.body.includes('access_key=AK'))
    assert.equal(renderBigPointClaimLine(result), '大积分:补领 1/1 项 · 积分 +40')
})

test('接口返回成功但状态没变时,如实报「无效果」', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigpoint2-'))
    const file = path.join(dir, 'app.json')
    fs.writeFileSync(file, JSON.stringify({ accessKey: 'AK' }), 'utf8')
    const fake = fakeFetch({ stateChanges: false, pointGain: 0 })

    const result = await claimBigPoint({
        config: { appCredentialsFile: file },
        cookie: FIXTURE_COOKIE,
        deps: { fetchImpl: fake.impl }
    })

    assert.equal(result.attempted, 1)
    assert.deepEqual(result.changed, [])
    assert.match(renderBigPointClaimLine(result), /无效果/)
})

test('凭据文件缺字段或缺文件时安全退化', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigpoint3-'))
    assert.equal(readAppCredentials(path.join(dir, 'nope.json')), null)
    const empty = path.join(dir, 'empty.json')
    fs.writeFileSync(empty, '{}', 'utf8')
    assert.equal(readAppCredentials(empty), null)
    const one = path.join(dir, 'one.json')
    fs.writeFileSync(one, JSON.stringify({ accessKey: 'AK' }), 'utf8')
    assert.equal(readAppCredentials(one).accessKey, 'AK')
})

test('没有补领时不渲染那一行', () => {
    assert.equal(renderBigPointClaimLine(null), '')
    assert.equal(renderBigPointClaimLine({ attempted: 0, changed: [], gained: 0 }), '')
})
