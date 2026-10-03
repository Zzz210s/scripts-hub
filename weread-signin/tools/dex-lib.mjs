// DEX 只读解析的小工具集:索引表、字符串、类/方法遍历、方法里的字符串常量。
// 供 tools/dex-*.mjs 复用;不依赖任何第三方库。
import fs from 'node:fs'

export function openDex(file) {
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

    const stringIdsSize = u32(0x38)
    const stringIdsOff = u32(0x3c)
    const typeIdsSize = u32(0x40)
    const typeIdsOff = u32(0x44)
    const methodIdsSize = u32(0x58)
    const methodIdsOff = u32(0x5c)
    const classDefsSize = u32(0x60)
    const classDefsOff = u32(0x64)

    const readString = index => {
        if (index < 0 || index >= stringIdsSize) return null
        const start = uleb128(u32(stringIdsOff + index * 4)).next
        let end = start
        while (buf[end] !== 0) end += 1
        return buf.toString('utf8', start, end)
    }
    const typeName = index => (index < 0 || index >= typeIdsSize ? null : readString(u32(typeIdsOff + index * 4)))
    const methodName = index => {
        if (index < 0 || index >= methodIdsSize) return null
        return { classIdx: u16(methodIdsOff + index * 8), nameIdx: u32(methodIdsOff + index * 8 + 4) }
    }

    /** 遍历所有类:回调 (className, methods[]),methods 项含 name / codeOff / strings[] */
    function eachClass(visit) {
        for (let c = 0; c < classDefsSize; c += 1) {
            const classDef = classDefsOff + c * 32
            const className = typeName(u32(classDef))
            const classDataOff = u32(classDef + 24)
            if (!classDataOff) continue
            const methods = []
            let cursor = classDataOff
            const staticFields = uleb128(cursor); cursor = staticFields.next
            const instanceFields = uleb128(cursor); cursor = instanceFields.next
            const directMethods = uleb128(cursor); cursor = directMethods.next
            const virtualMethods = uleb128(cursor); cursor = virtualMethods.next
            for (let i = 0; i < staticFields.value + instanceFields.value; i += 1) {
                cursor = uleb128(cursor).next      // field_idx_diff
                cursor = uleb128(cursor).next      // access_flags
            }
            let methodIdx = 0
            for (const count of [directMethods.value, virtualMethods.value]) {
                for (let i = 0; i < count; i += 1) {
                    methodIdx += uleb128(cursor).value; cursor = uleb128(cursor).next
                    const access = uleb128(cursor); cursor = access.next
                    const codeOff = uleb128(cursor); cursor = codeOff.next
                    const info = methodName(methodIdx)
                    methods.push({
                        name: info ? readString(info.nameIdx) : '?',
                        access: access.value,
                        codeOff: codeOff.value,
                        strings: codeOff.value ? codeStrings(codeOff.value) : []
                    })
                }
            }
            visit(className, methods)
        }
    }

    /** 取某个 code_item 里所有 const-string / const-string/jumbo 的字符串常量 */
    function codeStrings(codeOff) {
        const insnsSize = u32(codeOff + 12)
        const insnsOff = codeOff + 16
        const out = []
        for (let i = 0; i < insnsSize; i += 1) {
            const unit = u16(insnsOff + i * 2)
            if ((unit & 0xff) === 0x1a) {
                out.push(readString(u16(insnsOff + (i + 1) * 2)))
                i += 1
            } else if ((unit & 0xff) === 0x1b) {
                out.push(readString(u32(insnsOff + (i + 1) * 2)))
                i += 2
            }
        }
        return out.filter(Boolean)
    }

    return { readString, typeName, methodName, eachClass, codeStrings, stringIdsSize, classDefsSize, methodIdsSize }
}
