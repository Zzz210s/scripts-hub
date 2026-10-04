// 扫 DEX 的静态常量值(static_values),找出"哪个类的哪个字段"持有某个字符串。
//
// 为什么需要它:微信读书 App 的接口路径是 static final String 常量,代码里只引用字段、
// 不出现字面量,所以在代码里搜 const-string 是搜不到的(2026-10-02 实测)。
//
//   node tools/dex-static-values.mjs <dex> --find "/reader/welfareCoin"
//   node tools/dex-static-values.mjs <dex> --class Lcom/tencent/weread/xxx/Constants;
import fs from 'node:fs'

import { openDex } from './dex-lib.mjs'

const [file, mode, value] = process.argv.slice(2)
if (!file || !mode) {
    console.log('用法:node tools/dex-static-values.mjs <dex> --find <字符串> | --class <类名>')
    process.exit(1)
}

const buf = fs.readFileSync(file)
const dex = openDex(file)
const u16 = o => buf.readUInt16LE(o)
const u32 = o => buf.readUInt32LE(o)

function uleb128(offset) {
    let result = 0, shift = 0, cursor = offset
    for (;;) {
        const byte = buf[cursor]
        cursor += 1
        result |= (byte & 0x7f) << shift
        if ((byte & 0x80) === 0) break
        shift += 7
    }
    return { value: result >>> 0, next: cursor }
}

const fieldIdsSize = u32(0x50)
const fieldIdsOff = u32(0x54)
function fieldName(index) {
    if (index < 0 || index >= fieldIdsSize) return null
    return dex.readString(u32(fieldIdsOff + index * 8 + 4))
}

/** 读 encoded_value,只关心字符串/整数/布尔/空 */
function readValue(offset) {
    const head = buf[offset]
    const type = head & 0x1f
    const arg = head >> 5
    let cursor = offset + 1
    const readUnsigned = () => {
        let result = 0
        for (let i = 0; i < arg; i += 1) result |= buf[cursor + i] << (8 * i)
        cursor += arg
        return result >>> 0
    }
    if (type === 0x17) return { value: dex.readString(readUnsigned()), next: cursor }      // string
    if (type === 0x18) return { value: dex.typeName(readUnsigned()), next: cursor }        // type
    if (type === 0x04 || type === 0x02 || type === 0x00) return { value: readUnsigned(), next: cursor }
    if (type === 0x1f) return { value: arg !== 0, next: cursor }
    if (type === 0x1e) return { value: null, next: cursor }
    return { value: `<type ${type}>`, next: cursor }
}

/** 类的静态字段名(按声明顺序,与 static_values 一一对应) */
function staticFieldNames(classDataOff) {
    if (!classDataOff) return []
    let cursor = classDataOff
    const staticCount = uleb128(cursor); cursor = staticCount.next
    const instanceCount = uleb128(cursor); cursor = instanceCount.next
    const names = []
    let fieldIdx = 0
    for (let i = 0; i < staticCount.value; i += 1) {
        const diff = uleb128(cursor); cursor = diff.next
        fieldIdx += diff.value
        const access = uleb128(cursor); cursor = access.next
        names.push(fieldName(fieldIdx))
    }
    return names
}

const classDefsSize = u32(0x60)
const classDefsOff = u32(0x64)
let hits = 0
for (let c = 0; c < classDefsSize; c += 1) {
    const classDef = classDefsOff + c * 32
    const className = dex.typeName(u32(classDef))
    const classDataOff = u32(classDef + 24)
    const staticValuesOff = u32(classDef + 28)
    if (!staticValuesOff) continue
    const size = uleb128(staticValuesOff)
    if (size.value > 5000) continue
    let cursor = size.next
    const values = []
    for (let i = 0; i < size.value; i += 1) {
        const item = readValue(cursor)
        values.push(item.value)
        cursor = item.next
    }
    if (mode === '--find') {
        if (!values.some(v => typeof v === 'string' && v.includes(value))) continue
    } else if (className !== value) {
        continue
    }
    hits += 1
    const names = staticFieldNames(classDataOff)
    console.log(`\n=== ${className} (${values.length} 个静态常量) ===`)
    values.forEach((v, index) => {
        const text = typeof v === 'string' ? v : JSON.stringify(v)
        if (mode === '--class' || (typeof v === 'string' && v.includes(value))) {
            console.log(`  ${String(names[index] ?? `#${index}`).padEnd(28)} = ${text}`)
        }
    })
}
console.log(`\n共 ${hits} 个类`)
