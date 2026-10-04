// 导出 DEX 里的注解(Retrofit 风格的 @GET("/path") / @Query("name") 都在注解里,不在代码里)。
//
//   node tools/dex-annotations.mjs <dex> --find "/reader/welfareCoin"   # 哪个方法用了这个路径
//   node tools/dex-annotations.mjs <dex> --class Lcom/.../BookService;  # 该类所有方法的注解
//
// 只读解析;输出方法名与注解值,不涉及凭据。
import { openDex } from './dex-lib.mjs'

const [file, mode, value] = process.argv.slice(2)
if (!file || !mode) {
    console.log('用法:node tools/dex-annotations.mjs <dex> --find <字符串> | --class <类名>')
    process.exit(1)
}

const fs = await import('node:fs')
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

const VALUE = {
    BYTE: 0x00, SHORT: 0x02, CHAR: 0x03, INT: 0x04, LONG: 0x06,
    FLOAT: 0x10, DOUBLE: 0x11, METHOD: 0x1a, ENUM: 0x1b, ARRAY: 0x1c,
    ANNOTATION: 0x1d, NULL: 0x1e, BOOLEAN: 0x1f, STRING: 0x17, TYPE: 0x18, FIELD: 0x19
}

/** 解析 encoded_value;返回 JS 值(未知类型返回占位) */
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
    const readSigned = () => {
        let result = 0
        for (let i = 0; i < arg; i += 1) result |= buf[cursor + i] << (8 * i)
        cursor += arg
        const bits = arg * 8
        if (bits && bits < 32 && (result & (1 << (bits - 1)))) result |= ~((1 << bits) - 1)
        return result
    }
    switch (type) {
        case VALUE.STRING: {
            const idx = readUnsigned()
            return { value: dex.readString(idx), next: cursor }
        }
        case VALUE.TYPE: {
            const idx = readUnsigned()
            return { value: dex.typeName(idx), next: cursor }
        }
        case VALUE.INT: case VALUE.SHORT: case VALUE.BYTE: case VALUE.CHAR:
            return { value: readSigned(), next: cursor }
        case VALUE.LONG:
            return { value: readSigned(), next: cursor }
        case VALUE.BOOLEAN:
            return { value: arg !== 0, next: cursor }
        case VALUE.NULL:
            return { value: null, next: cursor }
        case VALUE.ENUM: {
            const fieldIdx = readUnsigned()
            return { value: `enum#${fieldIdx}`, next: cursor }
        }
        case VALUE.ARRAY: {
            const size = uleb128(cursor)
            cursor = size.next
            if (size.value > 200) return { value: `<array ${size.value}>`, next: cursor }   // 数据错位时保命
            const items = []
            for (let i = 0; i < size.value; i += 1) {
                const item = readValue(cursor)
                items.push(item.value)
                cursor = item.next
            }
            return { value: items, next: cursor }
        }
        default:
            return { value: `<type ${type}>`, next: cursor }
    }
}

function readAnnotation(offset) {
    const typeIdx = uleb128(offset)
    const size = uleb128(typeIdx.next)
    let cursor = size.next
    const pairs = []
    for (let i = 0; i < size.value; i += 1) {
        const nameIdx = uleb128(cursor)
        cursor = nameIdx.next
        const val = readValue(cursor)
        cursor = val.next
        pairs.push([dex.readString(nameIdx.value), val.value])
    }
    return { type: dex.typeName(typeIdx.value), pairs }
}

function annotationSet(offset) {
    const size = u32(offset)
    if (size > 200) return []   // 数据错位时保命
    const out = []
    for (let i = 0; i < size; i += 1) out.push(readAnnotation(u32(offset + 4 + i * 4)))
    return out
}

/** 遍历类的注解目录:返回 [{ methodIdx, annotations }] */
function methodAnnotations(annotationsOff) {
    if (!annotationsOff) return []
    const methodsSize = u32(annotationsOff + 8)
    const methodsOff = annotationsOff + 16 + u32(annotationsOff + 4) * 8   // 跳过字段注解
    const out = []
    for (let i = 0; i < methodsSize; i += 1) {
        const methodIdx = u32(methodsOff + i * 8)
        const setOff = u32(methodsOff + i * 8 + 4)
        if (!setOff) continue
        out.push({ methodIdx, annotations: annotationSet(setOff) })
    }
    return out
}

const classDefsSize = u32(0x60)
const classDefsOff = u32(0x64)
let hits = 0
for (let c = 0; c < classDefsSize; c += 1) {
    const classDef = classDefsOff + c * 32
    const className = dex.typeName(u32(classDef))
    const annotationsOff = u32(classDef + 20)
    if (!annotationsOff) continue
    const entries = methodAnnotations(annotationsOff)
    for (const entry of entries) {
        const info = dex.methodName(entry.methodIdx)
        const methodName = info ? dex.readString(info.nameIdx) : '?'
        const flat = entry.annotations.map(ann => (ann.pairs ?? []).map(p => String(p[1])).join('\u0001')).join('\u0001')
        const matches = mode === '--find' ? flat.includes(value) : className === value
        if (!matches) continue
        hits += 1
        console.log(`\n=== ${className}.${methodName} ===`)
        for (const ann of entry.annotations) {
            const short = ann.type?.replace(/^L|;$/g, '').split('/').pop()
            console.log(`  @${short} ${JSON.stringify(ann.pairs)}`)
        }
    }
}
console.log(`\n共 ${hits} 处`)
