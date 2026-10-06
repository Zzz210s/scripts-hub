// 脱敏规则回归测试:node --test scripts/test/
//
// 目的:锁住两件事 ——
//   ① 真凭据形状必须被命中(用户要求"保证个人隐私明文账号密码不会公开")
//   ② 代码里的变量引用、占位符、示例文件不能误报(否则闸门天天拦,就没人看了)
import assert from 'node:assert/strict'
import test from 'node:test'

import { CREDENTIAL_RULES, FORBIDDEN_PATH_RULES, allowPlaceholder, rulesWithPrivate } from '../lib/privacy-rules.mjs'

const hits = (line, rules = CREDENTIAL_RULES) =>
    rules.filter(([, re, allow]) => {
        if (!re) return false
        const m = re.exec(line)
        if (!m) return false
        return !(allow && allow(m[0]))
    }).map(([name]) => name)

test('真凭据:密码 / token / 私钥形状全部命中', () => {
    assert.deepEqual(hits('password = "hunter2xyz"'), ['密码赋值'])
    assert.deepEqual(hits('ACCOUNT_1_PASSWORD=SuperSecret123'), ['密码赋值'])
    assert.deepEqual(hits('api_key: "abcd1234efgh5678ijkl"'), ['令牌/密钥赋值'])
    assert.deepEqual(hits('GITHUB_TOKEN=ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'), ['GitHub 令牌'])
    assert.deepEqual(hits('OPENAI_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'), ['OpenAI 风格密钥'])
    assert.deepEqual(hits('AWS=AKIAIOSFODNN7EXAMPLE'), ['AWS Access Key'])
    assert.ok(hits('cookie: session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnop').includes('Cookie 值'))
    assert.ok(hits('-----BEGIN RSA PRIVATE KEY-----').includes('私钥内容'))
    assert.ok(hits('mongodb://admin:hunter2@db.example.com/app').includes('数据库连接串带密码'))
})

test('代码里的变量引用不误报', () => {
    for (const line of [
        'password = settings',
        'password = encodeURIComponent',
        'refreshToken = decodeURIComponent',
        'accessToken: payload.accessToken',
        'refresh_token: saved.refreshToken',
        'cookie = cookieToObject(parsed.cookie)',
        "const COOKIE = 'EPIC_BEARER_TOKEN'"
    ]) {
        assert.deepEqual(hits(line), [], `不该命中:${line}`)
    }
})

test('占位符与示例值不误报', () => {
    for (const line of [
        'PASSWORD=${ACCOUNT_PASSWORD}',
        'api_key: "YOUR_API_KEY"',
        'password: <your-password>',
        'token: "xxxxxxxxxxxx"',
        'ACCOUNT_1_PASSWORD=',
        'secret: "CHANGEME"'
    ]) {
        assert.deepEqual(hits(line), [], `不该命中:${line}`)
    }
    assert.equal(allowPlaceholder('PASSWORD=${A}'), true)
    assert.equal(allowPlaceholder('PASSWORD=SuperSecret123'), false)
})

test('文件路径规则:secrets/ 与真 .env 命中,示例文件放行', () => {
    const bad = ['.env', 'app/.env', 'app/.env.local', 'proj/secrets/epic-tokens.json', 'keys/id_rsa', 'cert/server.pem']
    const ok = ['.env.example', '.env.template', 'src/env.js', 'docs/secrets.md', 'keys/id_rsa.pub']
    for (const f of bad) assert.ok(FORBIDDEN_PATH_RULES.some(([re]) => re.test(f)), `应命中:${f}`)
    for (const f of ok) assert.ok(!FORBIDDEN_PATH_RULES.some(([re]) => re.test(f)), `不该命中:${f}`)
})

test('私有清单里的标识会变成规则', () => {
    const { rules } = rulesWithPrivate(['示例昵称'])
    const literal = rules.find(([name]) => name.includes('示例昵称'))
    assert.ok(literal, '私有标识应生成一条字面量规则')
    assert.equal(literal[3], '示例昵称')
})
