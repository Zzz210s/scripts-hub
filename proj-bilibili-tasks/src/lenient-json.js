// 上游 Console 用 Newtonsoft 序列化 cookies.json,输出**带尾逗号**(`"..." ,]` / `],}`),
// 严格 JSON.parse 会直接失败 —— 2026-10-11 首次真实扫码登录后实测:`check` 因此报
// 「没有可用的 cookies 文件」,等于拿到凭据也永远不跑。这里做容错解析:
// 只在「字符串之外、且后面只跟着 ] 或 }」时丢掉逗号,不会碰字符串里的内容。

/** 去掉字符串外的尾逗号(Newtonsoft 风格)。 */
export function stripTrailingCommas(text) {
    let out = ''
    let inString = false
    let escaped = false
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (inString) {
            out += ch
            if (escaped) escaped = false
            else if (ch === '\\') escaped = true
            else if (ch === '"') inString = false
            continue
        }
        if (ch === '"') { inString = true; out += ch; continue }
        if (ch === ',') {
            let j = i + 1
            while (j < text.length && /\s/.test(text[j])) j++
            if (text[j] === ']' || text[j] === '}') continue // 丢掉尾逗号与它前面的空白
            out += ch
            continue
        }
        out += ch
    }
    return out
}

/** 先严格解析;失败再按 Newtonsoft 风格容错解析;都失败返回 null。 */
export function parseLenient(text) {
    try {
        return JSON.parse(text)
    } catch {
        try {
            return JSON.parse(stripTrailingCommas(text))
        } catch {
            return null
        }
    }
}

/** 读文件并容错解析(读不到或解析不了返回 null)。 */
export function readJsonLenient(fs, path) {
    let text
    try {
        text = fs.readFileSync(path, 'utf8')
    } catch {
        return null
    }
    return parseLenient(text)
}
