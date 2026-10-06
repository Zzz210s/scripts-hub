// 笔记库快照的纯函数回归测试:node --test scripts/test/
//
// 锁住三件事:① 保留策略只动日期目录、永远留最新那份 ② 差异分类(HEAD vs 工作区)的判定口径
// ③ git 文本输出的解析(localDate 用本地时区,不能按 UTC 跨日;tar 路径必须转正斜杠)
import assert from 'node:assert/strict'
import test from 'node:test'

import { localDate } from '../lib/note-git.mjs'
import { planPrune, slash } from '../lib/note-store.mjs'
import { classifyAgainstHead, diffTrees, parseLsTree, parseRefs } from '../lib/note-drill.mjs'

test('保留策略:只保留最近 N 个日期目录,legacy 之类非日期条目不动', () => {
    const names = ['2026-10-03', '2026-10-05', '2026-10-04', 'legacy', 'README.md', '2026-10-06']
    assert.deepEqual(planPrune(names, 3), ['2026-10-03'])
    assert.deepEqual(planPrune(names, 4), [])
    assert.deepEqual(planPrune(names, 1), ['2026-10-05', '2026-10-04', '2026-10-03'])
})

test('保留策略:keep 为 0 或负数时至少留最新一份', () => {
    assert.deepEqual(planPrune(['2026-10-05', '2026-10-04'], 0), ['2026-10-04'])
    assert.deepEqual(planPrune(['2026-10-05', '2026-10-04'], -2), ['2026-10-04'])
})

test('差异分类:HEAD 有工作区没有=删除,内容不同=修改,工作区多出且没被忽略=未跟踪', () => {
    const tree = { 'a.md': 'sha-a', 'b.md': 'sha-b' }
    const blobs = { 'a.md': 'sha-a', 'b.md': 'sha-b2', 'c.md': 'sha-c', 'ignored/x': 'sha-x' }
    const expect = classifyAgainstHead(tree, blobs, new Set(['ignored/x']))
    assert.deepEqual(expect, { D: [], M: ['b.md'], '??': ['c.md'] })
})

test('差异分类:被 .gitignore 忽略的多出文件不计入 git status', () => {
    const expect = classifyAgainstHead({}, { '.obsidian/app.json': 'sha' }, new Set(['.obsidian/app.json']))
    assert.deepEqual(expect['??'], [])
})

test('localDate 用本地时区,不会按 UTC 跨日', () => {
    assert.equal(localDate(new Date(2026, 9, 6, 23, 30)), '2026-10-06')
    assert.equal(localDate(new Date(2026, 0, 1, 0, 5)), '2026-01-01')
})

test('tar 参数里的 Windows 路径要转正斜杠(GNU tar 把反斜杠当转义)', () => {
    assert.equal(slash('F:\\note-backups\\2026-10-05\\w.tar'), 'F:/note-backups/2026-10-05/w.tar')
    assert.equal(slash('already/posix'), 'already/posix')
})

test('解析 git show-ref / ls-tree 输出', () => {
    assert.deepEqual(parseRefs('abc123 refs/heads/master\ndef456 refs/remotes/origin/master\n'), {
        'refs/heads/master': 'abc123',
        'refs/remotes/origin/master': 'def456'
    })
    assert.deepEqual(parseLsTree('100644 blob aaa111\t记录/一.md\n100644 blob bbb222\tREADME.md\n'), {
        '记录/一.md': 'aaa111',
        'README.md': 'bbb222'
    })
})

test('逐文件对比:缺/多/内容不一致都要报出来', () => {
    const expected = { files: 2, bytes: 1, digest: '', byPath: { 'a': { sha256: '1' }, 'b': { sha256: '2' } } }
    const actual = { files: 2, bytes: 1, digest: '', byPath: { 'b': { sha256: '3' }, 'c': { sha256: '4' } } }
    const d = diffTrees(expected, actual)
    assert.equal(d.total, 3)
    assert.deepEqual(d.shown, ['缺:a', '内容不一致:b', '多出:c'])
})
