// 脱敏规则表 —— check-privacy.mjs 与"push 前闸门"共用同一份实现。
//
// 两类规则:
//   ① 个人标识:本机路径、手机号、昵称/用户名、私有清单(sensitive-patterns.txt)里的字面量
//   ② 明文凭据:账号密码、token、私钥、cookie —— 2026-10-05 按用户要求加入
//      ("保证个人隐私明文账号密码不会公开";AI 生成的记录同样适用这条)
//
// 规则只做"形状"判断,不判断真假;命中一律当待复核处理(闸门场景下即拦下)。占位符
// (xxx / EXAMPLE / ${VAR} / <...> / *** 等)由 allowPlaceholder 放行,避免文档误报。

const BS = String.fromCharCode(92)

export const ALLOWED_EMAILS = [/^zzz210s@qq\.com$/]
// 明确公开、不构成隐私的值(Epic 官方文档里的 OAuth client secret,免费游戏工具普遍使用)
export const ALLOWED_CREDENTIAL_VALUES = [/^0a2449a2-001a-451e-afec-3e812901c4d7$/]
export const ALLOWED_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'x.com']
export const ALLOWED_EMAIL_LOCALS = ['sample', 'user', 'email', 'alpha', 'beta', 'test', 'you']

/** 文档里常见的占位写法,不算真凭据。传进来的可能是整行(如 `password: "xxx"`),先剥掉键与引号 */
export function allowPlaceholder(value) {
    const v = String(value)
        .replace(/^[^:=]*[:=]\s*/, '')
        .replace(/^['"]|['"]$/g, '')
        .trim()
    if (!v) return true
    if (ALLOWED_CREDENTIAL_VALUES.some((re) => re.test(v))) return true
    if (/^(\$\{?[A-Z_]+\}?|<[^>]*>|\*+|-+|x{3,}|X{3,})$/.test(v)) return true
    if (/^[A-Z][A-Z0-9_]{4,}$/.test(v)) return true   // 全大写的常量名(如 EPIC_BEARER_TOKEN),不是值
    if (/(EXAMPLE|PLACEHOLDER|CHANGEME|YOUR_|REDACTED|TODO)/i.test(v)) return true
    if (/^['"]?\.\.\./.test(v)) return true
    return false
}

export function allowedEmail(value) {
    if (ALLOWED_EMAILS.some((re) => re.test(value))) return true
    const [local, domain] = String(value).split('@')
    return ALLOWED_EMAIL_DOMAINS.includes(domain) || ALLOWED_EMAIL_LOCALS.includes(local)
}

/** 通用规则:[名称, 正则, 允许函数] */
export const BASE_RULES = [
    ['本机用户目录路径', new RegExp(`[A-Za-z]:[${BS}${BS}${BS}/]{1,2}Users`, 'i'), null],
    // 笔记库自身的路径不算隐私:它已写在 0-Note(公开仓库)的项目说明里,
    // 而同步失败的提醒必须指名道姓告诉用户去哪修。命中片段只有 "F:\0" 这么长。
    // 2026-10-06 修:原来用 `[${BS}${BS}${BS}]{1,2}` 拼字符类,正则实际把分隔符当成了可选的,
    // 于是 `链路 C:Web checkout` 这种标题被误报成 `C:W`。改成显式的 [\\/] 并把"必须有分隔符"写死。
    ['盘符绝对路径', /(^|[^A-Za-z0-9])[A-Ga-g]:[\\/]{1,2}[A-Za-z0-9_]/, (v) => /^[^A-Za-z0-9]*[Ff]:/.test(v)],
    ['Unix 家目录路径', /\/home\/[a-z][a-z0-9_-]{2,}/, null],
    ['微软凭据形状', /wrk-(?!EXAMPLE|xxxxxxxx|x{4,})[A-Za-z0-9_-]{10,}/, null],
    ['企业微信 webhook 真 key', /webhook\/send\?key=(?!0{8}|YOUR_WEBHOOK_KEY)[A-Za-z0-9-]{20,}/, null],
    ['中国大陆手机号', /(^|[^\d-])1[3-9]\d{9}([^\d-]|$)/, null],
    ['微信 wxid', /wxid_[A-Za-z0-9]{6,}/, null],
    ['Epic OAuth 令牌', /eg1~[A-Za-z0-9._~+/-]{60,}/, null],
    ['邮箱', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, allowedEmail]
]

/** 明文凭据规则(2026-10-05 加)*/
export const CREDENTIAL_RULES = [
    ['私钥内容', /-----BEGIN [A-Z ]*PRIVATE KEY-----/, null],
    ['GitHub 令牌', /gh[pousr]_[A-Za-z0-9]{20,}/, null],
    ['OpenAI 风格密钥', /sk-[A-Za-z0-9_-]{20,}/, null],
    ['AWS Access Key', /AKIA[0-9A-Z]{16}/, null],
    ['JWT', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, null],
    ['SSH 公钥', /ssh-(rsa|ed25519|dss) AAAA[A-Za-z0-9+/]{30,}/, null],
    // 只认"字面量":带引号的值,或不带引号但很长(≥24 字符)且不含点/括号的值。
    // 这样 `refreshToken = decodeURIComponent`、`accessToken: payload.accessToken` 这类
    // 代码里的变量引用不会误报(2026-10-05 实测:不做这层区分会在源码里报 38 处假阳性)。
    ['密码赋值', /(password|passwd|pwd)\s*[:=]\s*(?:['"][^'"]{6,}['"]|(?=[A-Za-z0-9+/_\-=]{8,}\b)(?=[A-Za-z0-9+/_\-=]*\d)[A-Za-z0-9+/_\-=]+|[A-Za-z0-9+/_\-=]{20,}\b)/i, allowPlaceholder],
    [
        '令牌/密钥赋值',
        /(api[_-]?key|secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|bearer)\s*[:=]\s*(?:['"][^'"]{16,}['"]|[A-Za-z0-9+/_\-=]{24,}\b)/i,
        allowPlaceholder
    ],
    ['Cookie 值', /(cookie|set-cookie)\s*[:=]\s*(?:['"][^'"]{32,}['"]|[A-Za-z0-9+/_\-=]{24,}\b)/i, allowPlaceholder],
    ['Authorization 头', /authorization:\s*(basic|bearer)\s+[A-Za-z0-9+/=_.-]{16,}/i, null],
    ['数据库连接串带密码', /(mysql|postgres|postgresql|mongodb|redis):\/\/[^\s:@/]+:[^\s:@/]{4,}@/i, null]
]

/** 文件名规则:这类文件本就不该被跟踪 */
export const FORBIDDEN_PATH_RULES = [
    [/(^|\/)secrets\//, 'secrets 目录下的文件不应入库'],
    [/(^|\/)\.env($|\.(?!example|template|sample|dist$))/, '.env 类文件不应入库'],
    [/(^|\/)id_(rsa|ed25519|ecdsa|dsa)($|\.(?!pub$))/, 'SSH 私钥不应入库(公钥 .pub 放行)'],
    [/\.(pem|key|p12|pfx)$/i, '私钥/证书文件不应入库'],
    [/(^|\/)[^/]*(credential|token|secret)[^/]*\.json$/i, '凭据类 json 不应入库']
]

/** 把机器私有清单(一行一个标识)拼成规则;清单在仓库外,永不入库 */
export function rulesWithPrivate(privatePatterns) {
    const rules = [...BASE_RULES, ...CREDENTIAL_RULES]
    for (const p of privatePatterns) rules.push([`私有标识 ${p}`, null, null, p])
    return { rules, privatePatterns }
}
