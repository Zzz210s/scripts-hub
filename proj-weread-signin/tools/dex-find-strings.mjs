// 在 DEX 里找出"哪个类的哪个方法引用了某个字符串",并把该方法里所有字符串常量列出来。
// 用途:定位 App 调用某个接口的代码,从而看出它传了哪些参数(不用反编译整套 APK)。
//
//   node tools/dex-find-strings.mjs <dex 文件> "/reader/welfareCoin"
//
// 只做只读解析,输出类名/方法名与字符串常量,不涉及任何凭据。
import fs from 'node:fs'

const file = process.argv[2]
const needle = process.argv[3]
if (!file || !needle) {
    console.log('用法:node tools/dex-find-strings.mjs <dex> <要查找的字符串>')
    process.exit(1)
}

const buf = fs.readFileSync(file)
const u16 = offset => buf.readUInt16LE(offset)
const u32 = offset => buf.readUInt32LE(offset)

function uleb128(offset) {
    let result = 0
    let shift = 0
    let cursor = offset
    for (;;) {
        const byte = buf[cursor]
        cursor += 1
        result |= (byte & 0x7f) << shift
        if ((byte & 0x80) === 0) break
        shift += 7
    }
    return { value: result >>> 0, next: cursor }
}

// --- 各索引表 ---
const stringIdsSize = u32(0x38)
const stringIdsOff = u32(0x3c)
const typeIdsSize = u32(0x40)
const typeIdsOff = u32(0x44)
const methodIdsSize = u32(0x58)
const methodIdsOff = u32(0x5c)
const classDefsSize = u32(0x60)
const classDefsOff = u32(0x64)

function readString(index) {
    if (index < 0 || index >= stringIdsSize) return null
    const start = uleb128(u32(stringIdsOff + index * 4)).next
    let end = start
    while (buf[end] !== 0) end += 1
    return buf.toString('utf8', start, end)
}

function typeName(index) {
    if (index < 0 || index >= typeIdsSize) return null
    return readString(u32(typeIdsOff + index * 4))
}

function methodInfo(index) {
    if (index < 0 || index >= methodIdsSize) return null
    const base = methodIdsOff + index * 8
    return { classIdx: u16(base), nameIdx: u32(base + 4) }
}

const target = [...Array(stringIdsSize).keys()].find(i => readString(i) === needle)
if (target === undefined) {
    console.log(`没找到字符串:${needle}`)
    process.exit(1)
}
console.log(`目标字符串索引:${target}(${needle})`)

// --- 遍历类 -> 方法 -> 代码,找引用 ---
function methodStrings(codeOff) {
    const insnsSize = u32(codeOff + 12)
    const insnsOff = codeOff + 16
    const found = []
    for (let i = 0; i < insnsSize; i += 1) {
        const unit = u16(insnsOff + i * 2)
        if ((unit & 0xff) === 0x1a) {
            found.push(u16(insnsOff + (i + 1) * 2))
            i += 1
        } else if ((unit & 0xff) === 0x1b) {
            found.push(u32(insnsOff + (i + 1) * 2))
            i += 2
        }
    }
    return found
}

let hits = 0
for (let c = 0; c < classDefsSize; c += 1) {
    const classDef = classDefsOff + c * 32
    const classIdx = u32(classDef)
    const classDataOff = u32(classDef + 24)
    if (!classDataOff) continue
    const className = typeName(classIdx)
    let cursor = classDataOff
    const staticFields = uleb128(cursor); cursor = staticFields.next
    const instanceFields = uleb128(cursor); cursor = instanceFields.next
    const directMethods = uleb128(cursor); cursor = directMethods.next
    const virtualMethods = uleb128(cursor); cursor = virtualMethods.next
    for (let i = 0; i < staticFields.value + instanceFields.value; i += 1) {
        const fieldIdx = uleb128(cursor); cursor = fieldIdx.next
        const access = uleb128(cursor); cursor = access.next
    }
    let methodIdx = 0
    for (const count of [directMethods.value, virtualMethods.value]) {
        for (let i = 0; i < count; i += 1) {
            const diff = uleb128(cursor); cursor = diff.next
            methodIdx += diff.value
            const access = uleb128(cursor); cursor = access.next
            const codeOff = uleb128(cursor); cursor = codeOff.next
            if (!codeOff.value) continue
            const strings = methodStrings(codeOff.value)
            if (!strings.includes(target)) continue
            hits += 1
            const info = methodInfo(methodIdx)
            const name = info ? readString(info.nameIdx) : '?'
            console.log(`\n=== ${className}.${name} ===`)
            const rendered = [...new Set(strings.map(readString).filter(Boolean))]
                .filter(s => s.length < 80 && !/^L[a-zA-Z0-9/$_]+;$/.test(s))
            for (const s of rendered.slice(0, 40)) console.log('  ' + s)
        }
    }
}
console.log(`\n共 ${hits} 处引用`)
