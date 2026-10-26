// 生成器回归测试:node --test scripts/test/
//
// 为什么要测:生成器一写坏就是 7 处实现一起坏(比手抄错一处更严重)。这里用夹具目录
// 验证四件事 —— 注入正确、幂等、缺标记时整体不写、CRLF 目标被归一。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { extractBlock, groupForFile, plan, run, GROUPS } from '../gen-wecom-core.mjs'

const BEGIN = '// >>> demo begin'
const END = '// <<< demo end'
const SOURCE = [BEGIN, 'const answer = 42', END].join('\n')

/** 造一个夹具根:源文件 + 若干目标文件。 */
function fixture(targets) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-wecom-'))
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true })
    fs.writeFileSync(path.join(root, 'lib/source.js'), SOURCE + '\n', 'utf8')
    for (const [rel, text] of Object.entries(targets)) {
        const absolute = path.join(root, rel)
        fs.mkdirSync(path.dirname(absolute), { recursive: true })
        fs.writeFileSync(absolute, text, 'utf8')
    }
    return root
}

const groups = [{ name: 'demo', source: 'lib/source.js', begin: BEGIN, end: END, targets: ['a/one.js', 'b/two.js'] }]
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8')

test('注入:只改块,前后文与行尾不变', () => {
    const stale = ['#!/usr/bin/env node', '// 文件头注释', BEGIN, 'const answer = 1', END, '// 文件尾', ''].join('\n')
    const root = fixture({ 'a/one.js': stale, 'b/two.js': stale })
    const result = run({ root, groups })
    assert.equal(result.problems.length, 0)
    assert.equal(result.changed.length, 2)
    const after = read(root, 'a/one.js')
    assert.match(after, /^#!\/usr\/bin\/env node\n\/\/ 文件头注释\n/)
    assert.match(after, /\/\/ 文件尾\n$/)
    assert.equal(extractBlock(after, BEGIN, END), SOURCE)
})

test('幂等:已经是单一源的内容不再改动,文件字节不变', () => {
    const fresh = ['// 头', SOURCE, '// 尾', ''].join('\n')
    const root = fixture({ 'a/one.js': fresh, 'b/two.js': fresh })
    const before = read(root, 'a/one.js')
    const result = run({ root, groups })
    assert.equal(result.changed.length, 0)
    assert.equal(result.unchanged.length, 2)
    assert.equal(read(root, 'a/one.js'), before)
})

test('有目标缺标记时整体不写(不许只改一半)', () => {
    const stale = [BEGIN, 'const answer = 1', END, ''].join('\n')
    const root = fixture({ 'a/one.js': stale, 'b/two.js': '// 这个文件忘了标记\n' })
    const before = read(root, 'a/one.js')
    const result = run({ root, groups })
    assert.equal(result.problems.length, 1)
    assert.match(result.problems[0], /缺少 .*begin/)
    assert.equal(result.changed.length, 1, '计划里仍能看到待改项')
    assert.equal(read(root, 'a/one.js'), before, '但一个字节都不该被写')
})

test('--check 语义:plan 报告 changed 而 run(write:false) 不落盘', () => {
    const stale = [BEGIN, 'const answer = 1', END, ''].join('\n')
    const root = fixture({ 'a/one.js': stale, 'b/two.js': stale })
    const planned = plan({ root, groups })
    assert.equal(planned.problems.length, 0)
    assert.equal(planned.actions.filter(a => a.changed).length, 2)
    const dry = run({ root, groups, write: false })
    assert.equal(dry.changed.length, 2)
    assert.match(read(root, 'a/one.js'), /answer = 1/, 'write:false 时文件必须原样')
})

test('源文件本身必须整体是块(多一段内容就报错)', () => {
    const root = fixture({ 'a/one.js': '// 无标记\n', 'b/two.js': '// 无标记\n' })
    fs.writeFileSync(path.join(root, 'lib/source.js'), `// 杂项\n${SOURCE}\n`, 'utf8')
    const result = run({ root, groups })
    assert.equal(result.problems.length, 3, '源文件一条 + 两个目标各一条')
    assert.match(result.problems[0], /源文件本身不合法/)
})

test('CRLF 目标被归一后注入(块始终是 LF)', () => {
    const crlf = ['// 头\r\n', BEGIN + '\r\n', 'const answer = 1\r\n', END + '\r\n', '// 尾\r\n'].join('')
    const root = fixture({ 'a/one.js': crlf, 'b/two.js': crlf })
    const result = run({ root, groups })
    assert.equal(result.problems.length, 0)
    assert.equal(extractBlock(read(root, 'a/one.js'), BEGIN, END), SOURCE)
})

test('额外目标按扩展名归组,认不出就报错', () => {
    assert.equal(groupForFile('x/wecom.js').name, 'wecom-core')
    assert.equal(groupForFile('x/notify.sh').name, 'wecom-notify')
    assert.throws(() => groupForFile('x/mystery.txt'), /无法判断/)
})

test('仓内每份实现与单一源一致(真实落点,兜住手改)', () => {
    const result = run({ write: false })
    assert.equal(result.problems.length, 0)
    assert.deepEqual(result.changed.map(a => a.path), [], '有文件与 scripts/lib 的单一源不一致,跑 node scripts/gen-wecom-core.mjs 注入')
    // 不写死份数:新增一份实现时改 targets 就够了,别让计数常量成为第二次维护点
    assert.equal(result.unchanged.length, GROUPS.reduce((n, g) => n + g.targets.length, 0))
})
