#!/usr/bin/env node
// 把共享代码块的**单一源**注入到各实现里,消灭"改一处要手抄 N 处"。
//
// 用法:
//   node scripts/gen-wecom-core.mjs                   注入(只改不一致的文件)
//   node scripts/gen-wecom-core.mjs --check           只检查,有不一致退出 1
//   node scripts/gen-wecom-core.mjs --dry-run         打印将要改动的文件,不写
//   node scripts/gen-wecom-core.mjs --group wecom-core --extra <文件>
//                                                     额外目标(快照项目在权威工作区那份)
//
// 为什么是"生成"而不是"共享包":各实现的宿主各自独立部署(容器构建上下文互不相通),
// 两个快照项目的真源还在别的工作区里;跨目录 import 会把"改一处"变成"改多处工作流"。
// 单一源放 scripts/lib/,注入后仍是各自内嵌,部署形态零变化。历史背景见 docs/wecom-rules.md。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 两个共享块:源文件 + 标记 + 各实现落点。 */
export const GROUPS = [
    {
        name: 'wecom-core',
        source: 'scripts/lib/wecom-core.js',
        begin: '// >>> wecom-core begin',
        end: '// <<< wecom-core end',
        targets: [
            'proj-microsoft-rewards/wechat-bridge/lib/wecom.js',
            'proj-weread-signin/src/notify.js',
            'proj-epic-free-games/src/notify.js',
            'proj-bilibili-tasks/src/notify.js',
            'proj-baidu-tieba/src/notify.js',
            'proj-netease-cloud/src/notify.js'
        ]
    },
    {
        name: 'wecom-notify',
        source: 'scripts/lib/wecom-notify.py',
        begin: '# >>> wecom-notify begin',
        end: '# <<< wecom-notify end',
        targets: [
            'scripts/note-sync/notify-wecom.sh',
            'scripts/linux/note-sync/note-sync.sh',
            'scripts/linux/mem-guard/mem-guard.sh'
        ]
    }
]

const groupByName = name => {
    const group = GROUPS.find(g => g.name === name)
    if (!group) throw new Error(`未知的组:${name}(可选:${GROUPS.map(g => g.name).join(', ')})`)
    return group
}

/** 额外目标按扩展名归类:.js -> wecom-core,.sh -> wecom-notify。 */
export function groupForFile(file) {
    if (file.endsWith('.js') || file.endsWith('.mjs')) return groupByName('wecom-core')
    if (file.endsWith('.sh')) return groupByName('wecom-notify')
    throw new Error(`无法判断 ${file} 属于哪一组(按扩展名推断失败,请用 --group 指定)`)
}

/** 取出文本里 begin 到 end 标记行末之间的整块(含两行标记)。 */
export function extractBlock(text, begin, end) {
    const at = text.indexOf(begin)
    const stop = text.indexOf(end, at === -1 ? 0 : at)
    if (at === -1 || stop === -1 || stop < at) return null
    const eol = text.indexOf('\n', stop)
    return text.slice(at, eol === -1 ? text.length : eol)
}

/** 读源文件得到"要注入的块"(去掉文件末尾那一个换行)。 */
export function readSource(root, group) {
    const text = fs.readFileSync(path.join(root, group.source), 'utf8').replace(/\r\n/g, '\n')
    return text.endsWith('\n') ? text.slice(0, -1) : text
}

/**
 * 计划本轮动作。返回 {actions, problems}:actions 里 changed=true 的才是需要写的文件。
 * 缺标记一律记进 problems —— 调用方必须先看到 problems 为空再写,避免只改一半。
 */
export function plan({ root, extras = [], groups = GROUPS }) {
    const actions = []
    const problems = []
    for (const group of groups) {
        const source = readSource(root, group)
        if (extractBlock(source, group.begin, group.end) !== source) {
            problems.push(`${group.source}: 源文件本身不合法(必须整体是 begin..end 标记内的块)`)
        }
        const extraForGroup = extras.filter(f => groups.includes(groupForFile(f)))
        for (const relative of [...group.targets, ...extraForGroup]) {
            const absolute = path.isAbsolute(relative) ? relative : path.join(root, relative)
            let text
            try {
                text = fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n')
            } catch (error) {
                problems.push(`${relative}: 读不到(${error.message})`)
                continue
            }
            const current = extractBlock(text, group.begin, group.end)
            if (current === null) {
                problems.push(`${relative}: 缺少 ${group.begin} .. ${group.end} 标记,拒绝改动`)
                continue
            }
            actions.push({
                group: group.name,
                path: relative,
                absolute,
                changed: current !== source,
                next: text.slice(0, text.indexOf(current)) + source + text.slice(text.indexOf(current) + current.length)
            })
        }
    }
    return { actions, problems }
}

/** 注入一次。返回 {changed, unchanged, problems}。 */
export function run({ root = ROOT, extras = [], groups = GROUPS, write = true } = {}) {
    const { actions, problems } = plan({ root, extras, groups })
    const changed = actions.filter(a => a.changed)
    if (problems.length === 0 && write) {
        for (const action of changed) fs.writeFileSync(action.absolute, action.next, 'utf8')
    }
    return { changed, unchanged: actions.filter(a => !a.changed), problems, actions }
}

function parseArgs(argv) {
    const groups = []
    const extras = []
    let check = false
    let dryRun = false
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--check') check = true
        else if (arg === '--dry-run') dryRun = true
        else if (arg === '--group') groups.push(groupByName(argv[++i]))
        else if (arg === '--extra') extras.push(argv[++i])
        else if (arg === '--help' || arg === '-h') return { help: true }
        else throw new Error(`不认识的参数:${arg}`)
    }
    return { check, dryRun, extras, groups: groups.length ? groups : GROUPS, help: false }
}

const USAGE = [
    '用法:',
    '  node scripts/gen-wecom-core.mjs [--check] [--dry-run] [--group <name>] [--extra <file>]...',
    '',
    `组:${GROUPS.map(g => `${g.name}(${g.targets.length} 份)`).join('  ')}`
].join('\n')

function main() {
    const opts = parseArgs(process.argv.slice(2))
    if (opts.help) {
        process.stdout.write(USAGE + '\n')
        return 0
    }
    const result = run({ extras: opts.extras, groups: opts.groups, write: !opts.check && !opts.dryRun })
    if (result.problems.length) {
        for (const problem of result.problems) process.stderr.write(`[gen-wecom] ${problem}\n`)
        process.stderr.write('[gen-wecom] 有问题,未改动任何文件\n')
        return 1
    }
    for (const action of result.changed) {
        const verb = opts.check ? '不一致' : opts.dryRun ? '将注入' : '已注入'
        process.stdout.write(`[gen-wecom] ${verb}:${action.group} · ${action.path}\n`)
    }
    const total = result.changed.length + result.unchanged.length
    if (opts.check) {
        if (result.changed.length) {
            process.stderr.write(`[gen-wecom] 失败:${result.changed.length}/${total} 份与单一源不一致,跑不带 --check 的同一命令注入\n`)
            return 1
        }
        process.stdout.write(`[gen-wecom] 通过:${total} 份与单一源一致\n`)
        return 0
    }
    process.stdout.write(`[gen-wecom] ${opts.dryRun ? '(dry-run)' : ''}改动 ${result.changed.length} 份,已是最新 ${result.unchanged.length} 份(共 ${total})\n`)
    return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
    try {
        process.exit(main())
    } catch (error) {
        process.stderr.write(`[gen-wecom] ${error.message}\n`)
        process.exit(1)
    }
}
