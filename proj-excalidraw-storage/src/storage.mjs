// Excalidraw 场景的服务器端存储:一个只有文件系统的极简 REST 服务。
//
// 设计取舍:
// - 只认真实目录树(/data/scenes 下),因为需求是"能选文件夹";每张图是一个 .excalidraw 文件(JSON)。
// - 不做数据库:备份 = cp -a,导出/查看 = 直接读文件。
// - 路径一律相对根目录、且必须落在根目录内(防穿越);文件名后缀限定 .excalidraw。
// - 保存带版本号(文件 mtime+size 的指纹):调用方带上读到的版本,不一致就 409,避免静默覆盖别人刚存的。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const ROOT = path.resolve(process.env.ROOT ?? '/data/scenes')
const PORT = Number(process.env.PORT ?? 9100)
const BIND = process.env.BIND ?? '0.0.0.0'
// 令牌来源优先文件(600 的 token.txt,便于轮换),其次环境变量。
function readToken() {
    const file = process.env.RELAY_TOKEN_FILE
    if (file) {
        try {
            return fs.readFileSync(file, 'utf8').trim()
        } catch (error) {
            process.stderr.write(`[storage] 读不到令牌文件 ${file}: ${String(error)}
`)
            process.exit(1)
        }
    }
    return process.env.RELAY_TOKEN ?? process.env.TOKEN ?? ''
}
const TOKEN = readToken()
const MAX_BODY = Number(process.env.MAX_BODY_MB ?? 32) * 1024 * 1024
const SUFFIX = '.excalidraw'

const log = (m) => process.stdout.write(`[storage] ${new Date().toISOString()} ${m}\n`)

/** 把调用方给的相对路径解析成绝对路径;越界或形状不合法一律返回 null。 */
export function resolveSafe(root, relPath, { allowDir = false } = {}) {
    if (typeof relPath !== 'string' || relPath.length === 0) return null
    if (relPath.includes('\u0000')) return null
    const normalized = path.normalize(relPath).replace(/^([/\\])+/, '')
    if (normalized.startsWith('..')) return null
    const absolute = path.resolve(root, normalized)
    if (absolute !== root && !absolute.startsWith(root + path.sep)) return null
    if (!allowDir && !absolute.endsWith(SUFFIX)) return null
    return absolute
}

/** 文件版本指纹:大小 + mtime(毫秒)。比内容哈希便宜,足够发现"被别人改过"。 */
export function versionOf(stat) {
    return `${stat.size}-${Math.round(stat.mtimeMs)}`
}

/** 递归列出目录:目录与文件都只给相对路径。 */
export function listTree(root) {
    const folders = []
    const files = []
    const walk = (dir) => {
        let entries
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue
            const absolute = path.join(dir, entry.name)
            const relative = path.relative(root, absolute).split(path.sep).join('/')
            if (entry.isDirectory()) {
                folders.push({ path: relative })
                walk(absolute)
            } else if (entry.isFile() && entry.name.endsWith(SUFFIX)) {
                try {
                    const stat = fs.statSync(absolute)
                    files.push({ path: relative, name: entry.name, size: stat.size, mtime: stat.mtimeMs, version: versionOf(stat) })
                } catch {
                    // 读不到就跳过,不让单个坏文件毁掉整棵目录树
                }
            }
        }
    }
    walk(root)
    folders.sort((a, b) => a.path.localeCompare(b.path))
    files.sort((a, b) => b.mtime - a.mtime)
    return { folders, files }
}

function reply(res, code, payload) {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(payload))
}

function authorized(req) {
    if (!TOKEN) return true
    const header = req.headers.authorization ?? ''
    const given = header.startsWith('Bearer ') ? header.slice(7) : ''
    // 长度不同直接失败;相同则逐字节比较(避免时序侧信道)
    if (given.length !== TOKEN.length) return false
    let diff = 0
    for (let i = 0; i < TOKEN.length; i++) diff |= given.charCodeAt(i) ^ TOKEN.charCodeAt(i)
    return diff === 0
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0
        const chunks = []
        req.on('data', (chunk) => {
            if (size > MAX_BODY) return          // 已经判超限:丢掉后续数据,等 end
            size += chunk.length
            if (size > MAX_BODY) {
                // 不直接 destroy —— 那样客户端只会看到 ECONNRESET,拿不到原因
                const error = new Error('请求体过大')
                error.code = 'TOO_LARGE'
                chunks.length = 0
                reject(error)
                return
            }
            chunks.push(chunk)
        })
        req.on('end', () => {
            try {
                resolve(Buffer.concat(chunks).toString('utf8'))
            } catch (error) {
                reject(error)
            }
        })
        req.on('error', reject)
    })
}

/** GET /api/scene?path=... —— 返回场景与版本指纹。 */
function getScene(res, url) {
    const absolute = resolveSafe(ROOT, url.searchParams.get('path'))
    if (!absolute) return reply(res, 400, { error: '路径不合法' })
    try {
        const stat = fs.statSync(absolute)
        const scene = JSON.parse(fs.readFileSync(absolute, 'utf8'))
        return reply(res, 200, { scene, version: versionOf(stat), path: url.searchParams.get('path') })
    } catch {
        return reply(res, 404, { error: '文件不存在' })
    }
}

/** PUT /api/scene?path=... body {scene, baseVersion?} —— baseVersion 不匹配则 409。 */
async function putScene(req, res, url) {
    const relative = url.searchParams.get('path')
    const absolute = resolveSafe(ROOT, relative)
    if (!absolute) return reply(res, 400, { error: '路径不合法(需要 .excalidraw 结尾且不出根目录)' })
    let payload
    try {
        payload = JSON.parse(await readBody(req))
    } catch (error) {
        if (error.code === 'TOO_LARGE') return reply(res, 413, { error: `请求体超过 ${MAX_BODY / 1024 / 1024}MB 上限` })
        return reply(res, 400, { error: `正文不是合法 JSON: ${error.message}` })
    }
    if (!payload || typeof payload.scene !== 'object' || payload.scene === null) {
        return reply(res, 400, { error: '缺少 scene' })
    }
    try {
        const stat = fs.statSync(absolute)
        if (payload.baseVersion && versionOf(stat) !== payload.baseVersion) {
            return reply(res, 409, { error: '服务器上的文件已被更新', version: versionOf(stat) })
        }
    } catch {
        if (payload.baseVersion) return reply(res, 409, { error: '服务器上的文件已不存在', version: null })
    }
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    const tmp = `${absolute}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(payload.scene), 'utf8')
    fs.renameSync(tmp, absolute)
    return reply(res, 200, { ok: true, path: relative, version: versionOf(fs.statSync(absolute)) })
}

async function handle(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (url.pathname === '/health') {
        return reply(res, 200, { ok: true, root: ROOT, files: listTree(ROOT).files.length })
    }
    if (!authorized(req)) return reply(res, 401, { error: '令牌不对' })

    if (url.pathname === '/api/tree' && req.method === 'GET') return reply(res, 200, listTree(ROOT))
    if (url.pathname === '/api/scene' && req.method === 'GET') return getScene(res, url)
    if (url.pathname === '/api/scene' && req.method === 'PUT') return putScene(req, res, url)

    if (url.pathname === '/api/folder' && req.method === 'POST') {
        let body
        try {
            body = JSON.parse(await readBody(req))
        } catch {
            return reply(res, 400, { error: '正文不是合法 JSON' })
        }
        const absolute = resolveSafe(ROOT, body?.path, { allowDir: true })
        if (!absolute) return reply(res, 400, { error: '路径不合法' })
        fs.mkdirSync(absolute, { recursive: true })
        return reply(res, 200, { ok: true, path: body.path })
    }

    if (url.pathname === '/api/item' && req.method === 'DELETE') {
        const relative = url.searchParams.get('path') ?? ''
        const asDir = resolveSafe(ROOT, relative, { allowDir: true })
        const asFile = resolveSafe(ROOT, relative)
        const absolute = asFile && fs.existsSync(asFile) ? asFile : asDir
        if (!absolute || absolute === ROOT) return reply(res, 400, { error: '路径不合法' })
        try {
            const stat = fs.statSync(absolute)
            if (stat.isDirectory()) {
                if (fs.readdirSync(absolute).length > 0) return reply(res, 409, { error: '目录不为空' })
                fs.rmdirSync(absolute)
            } else {
                fs.unlinkSync(absolute)
            }
            return reply(res, 200, { ok: true })
        } catch {
            return reply(res, 404, { error: '不存在' })
        }
    }

    return reply(res, 404, { error: '没有这个接口' })
}

const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
        log(`请求失败: ${String(error)}`)
        if (!res.headersSent) reply(res, 500, { error: '服务端错误' })
        else res.end()
    })
})

if (process.env.NODE_ENV !== 'test') {
    fs.mkdirSync(ROOT, { recursive: true })
    server.listen(PORT, BIND, () => log(`存储服务就绪 http://${BIND}:${PORT} 根目录=${ROOT} 令牌=${TOKEN ? '已启用' : '未启用'}`))
}

export { server }
