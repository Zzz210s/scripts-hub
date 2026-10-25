// 路径安全、目录树、版本冲突、鉴权 —— 存储服务最容易出错的地方都在这里。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

process.env.NODE_ENV = 'test'
process.env.ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'exc-store-'))
process.env.RELAY_TOKEN = 'test-token'
process.env.MAX_BODY_MB = '1'   // 测试里把上限压到 1MB,免得真造 32MB 载荷

const { resolveSafe, versionOf, listTree } = await import('../src/storage.mjs')
const { server } = await import('../src/storage.mjs')
const ROOT = process.env.ROOT

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const call = async (method, url, body, token = 'test-token') => {
    const headers = { 'content-type': 'application/json' }
    if (token) headers.authorization = `Bearer ${token}`
    const response = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() }
}

test('路径穿越一律拒绝', () => {
    for (const bad of ['../x.excalidraw', 'a/../../x.excalidraw', '/etc/passwd', 'x.txt', '', 'a\u0000b.excalidraw']) {
        assert.equal(resolveSafe(ROOT, bad), null, `应拒绝 ${JSON.stringify(bad)}`)
    }
    assert.ok(resolveSafe(ROOT, '笔记/架构.excalidraw'))
    assert.ok(resolveSafe(ROOT, 'a/b/c.excalidraw'))
})

test('建文件夹 -> 保存 -> 列表 -> 读取', async () => {
    assert.equal((await call('POST', '/api/folder', { path: '笔记' })).status, 200)

    const scene = { type: 'excalidraw', version: 2, elements: [{ id: 'e1' }], files: {} }
    const saved = await call('PUT', '/api/scene?path=' + encodeURIComponent('笔记/架构.excalidraw'), { scene })
    assert.equal(saved.status, 200)
    assert.ok(saved.json.version)

    const tree = await call('GET', '/api/tree')
    assert.deepEqual(tree.json.folders.map((f) => f.path), ['笔记'])
    assert.deepEqual(tree.json.files.map((f) => f.path), ['笔记/架构.excalidraw'])

    const loaded = await call('GET', '/api/scene?path=' + encodeURIComponent('笔记/架构.excalidraw'))
    assert.equal(loaded.status, 200)
    assert.deepEqual(loaded.json.scene.elements, [{ id: 'e1' }])
    assert.equal(loaded.json.version, saved.json.version)
})

test('baseVersion 不一致时 409,不覆盖别人刚存的', async () => {
    const scene = { type: 'excalidraw', elements: [] }
    const first = await call('PUT', '/api/scene?path=冲突.excalidraw', { scene })
    assert.equal(first.status, 200)

    // 别人又存了一次
    const second = await call('PUT', '/api/scene?path=冲突.excalidraw', { scene, baseVersion: first.json.version })
    assert.equal(second.status, 200)

    // 我拿着旧版本再存 -> 409
    const stale = await call('PUT', '/api/scene?path=冲突.excalidraw', { scene, baseVersion: first.json.version })
    assert.equal(stale.status, 409)
    assert.equal(stale.json.version, second.json.version)
})

test('不存在的文件带 baseVersion 保存 -> 409(别人删了)', async () => {
    const res = await call('PUT', '/api/scene?path=幽灵.excalidraw', { scene: {}, baseVersion: '1-1' })
    assert.equal(res.status, 409)
})

test('没有令牌 -> 401;健康检查不需要令牌', async () => {
    assert.equal((await call('GET', '/api/tree', undefined, 'wrong')).status, 401)
    assert.equal((await call('GET', '/health', undefined, '')).status, 200)
})

test('删除:先删文件,再删空目录;非空目录 409', async () => {
    await call('POST', '/api/folder', { path: '待删' })
    await call('PUT', '/api/scene?path=' + encodeURIComponent('待删/a.excalidraw'), { scene: { elements: [] } })
    assert.equal((await call('DELETE', '/api/item?path=' + encodeURIComponent('待删'))).status, 409)
    assert.equal((await call('DELETE', '/api/item?path=' + encodeURIComponent('待删/a.excalidraw'))).status, 200)
    assert.equal((await call('DELETE', '/api/item?path=' + encodeURIComponent('待删'))).status, 200)
})

test('坏文件不该毁掉整棵目录树', async () => {
    fs.writeFileSync(path.join(ROOT, '好的.excalidraw'), JSON.stringify({ elements: [] }))
    fs.writeFileSync(path.join(ROOT, '坏的.excalidraw'), 'not json at all')
    const tree = listTree(ROOT)
    assert.ok(tree.files.some((f) => f.path === '好的.excalidraw'))
})

test('versionOf 随文件改动而变化', async () => {
    const file = path.join(ROOT, '版本.excalidraw')
    fs.writeFileSync(file, '{}')
    const before = versionOf(fs.statSync(file))
    await new Promise((resolve) => setTimeout(resolve, 10))
    fs.writeFileSync(file, '{"elements":[]}')
    assert.notEqual(versionOf(fs.statSync(file)), before)
})

test('未知接口回 404', async () => {
    const res = await call('GET', '/api/nope')
    assert.equal(res.status, 404)
    assert.equal(res.json.error, '没有这个接口')
})

test('超大正文被拒', async () => {
    const huge = { scene: { elements: ['x'.repeat(2 * 1024 * 1024)] } }
    const res = await call('PUT', '/api/scene?path=huge.excalidraw', huge)
    assert.equal(res.status, 413, '请求体超过上限应回 413 且带原因')
})

test.after(() => {
    server.close()
    fs.rmSync(ROOT, { recursive: true, force: true })
})
