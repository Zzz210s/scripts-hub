// 按类名片段列出 DEX 里的类;或导出某个类的全部方法及其字符串常量。
// 用途:定位"领书币"相关的实现类,从它的方法里看出调用哪些接口、传什么参数。
//
//   node tools/dex-inspect-class.mjs <dex> --list welfare
//   node tools/dex-inspect-class.mjs <dex> --class Lcom/tencent/weread/xxx/WelfareFragment;
//   node tools/dex-inspect-class.mjs <dex> --strings welfareCoin      # 谁的方法里出现该字符串
import { openDex } from './dex-lib.mjs'

const [file, mode, value] = process.argv.slice(2)
if (!file || !mode) {
    console.log('用法:node tools/dex-inspect-class.mjs <dex> --list <片段> | --class <类名> | --strings <片段>')
    process.exit(1)
}

const dex = openDex(file)
const clean = list => [...new Set(list)].filter(s => s.length < 90)

if (mode === '--list') {
    const hits = []
    dex.eachClass((className, methods) => {
        if (className && className.toLowerCase().includes(value.toLowerCase())) hits.push({ className, count: methods.length })
    })
    console.log(`匹配 "${value}" 的类 ${hits.length} 个:`)
    for (const hit of hits.sort((a, b) => b.count - a.count)) console.log(`  ${hit.className}  (${hit.count} 个方法)`)
} else if (mode === '--class') {
    let printed = 0
    dex.eachClass((className, methods) => {
        if (className !== value) return
        printed += 1
        console.log(`=== ${className} (${methods.length} 个方法) ===`)
        for (const method of methods) {
            const interesting = clean(method.strings).filter(s => s.length > 2 && !/^L[a-zA-Z0-9/$_]+;$/.test(s))
            if (!interesting.length) continue
            console.log(`\n  -- ${method.name}`)
            for (const s of interesting.slice(0, 30)) console.log('     ' + s)
        }
    })
    if (!printed) console.log('没找到该类')
} else if (mode === '--strings') {
    let printed = 0
    dex.eachClass((className, methods) => {
        for (const method of methods) {
            if (!method.strings.some(s => s.includes(value))) continue
            printed += 1
            console.log(`\n=== ${className}.${method.name} ===`)
            for (const s of clean(method.strings).slice(0, 40)) console.log('  ' + s)
        }
    })
    console.log(`\n共 ${printed} 个方法包含 "${value}"`)
} else {
    console.log('未知模式:' + mode)
}
