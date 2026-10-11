import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripTrailingCommas, parseLenient } from '../src/lenient-json.js'

// 夹具形状取自 2026-10-11 首次真实扫码登录后 Console 写下的 cookies.json(已脱敏):
// 4 行缩进、数组元素后有逗号、对象闭合处也有逗号。
const REAL_SHAPE = '{\n  "BiliBiliCookies":[\n    "SESSDATA=abc; bili_jct=def; DedeUserID=123",\n  ],\n}'

test('严格 JSON 能解析的输入原样通过', () => {
    const parsed = parseLenient('{"a":[1,2]}')
    assert.deepEqual(parsed, { a: [1, 2] })
})

test('Newtonsoft 尾逗号形式能被解析(真实登录产物形状)', () => {
    const parsed = parseLenient(REAL_SHAPE)
    assert.equal(Array.isArray(parsed.BiliBiliCookies), true)
    assert.equal(parsed.BiliBiliCookies.length, 1)
    assert.match(parsed.BiliBiliCookies[0], /SESSDATA=abc/)
})

test('字符串里的 ,] 与 ,} 不被误改', () => {
    const parsed = parseLenient('{"c":["a,]b", "x,}y",]}')
    assert.deepEqual(parsed.c, ['a,]b', 'x,}y'])
    assert.equal(stripTrailingCommas('{"c":["a,]b", "x,}y",]}'), '{"c":["a,]b", "x,}y"]}')
})

test('转义引号不会让状态机跑偏', () => {
    const parsed = parseLenient('{"c":["he said \\"ok\\", then left",]}')
    assert.deepEqual(parsed.c, ['he said "ok", then left'])
})

test('尾逗号后有空白与换行也能处理', () => {
    assert.deepEqual(parseLenient('{"a":[1,2 ,\n ] ,\n}'), { a: [1, 2] })
})

test('彻底不是 JSON 时返回 null 而不是抛错', () => {
    assert.equal(parseLenient('<html>404</html>'), null)
    assert.equal(parseLenient(''), null)
})
