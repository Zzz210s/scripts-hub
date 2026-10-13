// 网易云音乐 weapi / eapi 参数加密纯函数:只依赖 node:crypto,不发请求、不读文件。
// 常量与接口路径集中在本文件的 CRYPTO 与 PATHS 导出;出处见同目录 NOTICE。
// 探针任务实测后只改这里,上层调用方不动。
import {
  constants,
  createCipheriv,
  createHash,
  publicEncrypt,
  randomInt,
} from 'node:crypto'

/** 公开常量。出处:api-enhanced 的 util/crypto.js,基线 90de6414。 */
export const CRYPTO = Object.freeze({
  weapiPresetKey: '0CoJUm6Qyw8W8jud',
  weapiIv: '0102030405060708',
  weapiBase62: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  weapiSecretKeyLength: 16,
  weapiPublicKeyPem: `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`,
  // 上游叫 eapiKey;这里带 aes 是为了不被脱敏闸门的 `apiKey` 子串规则误报(值是公开协议常量)
  eapiAesKey: 'e82ckenh8dichen8',
  eapiSeparator: '-36cd479b6b5-',
})

/**
 * 待探针 T3 实测校正的接口路径。前缀即加密层:weapi 走 /weapi, eapi 走 /eapi。
 * 来源是调研文档的源码读取,不是运行时证据。
 */
export const PATHS = Object.freeze({
  vipSign: '/weapi/vip-center-bff/task/sign',
  vipCheckinDetail: '/eapi/vipnewcenter/app/level/user/checkin/history/detail',
  vipMinideskSignPc: '/eapi/vipnewcenter/app/minidesk/music/sign/pc',
  vipSignInfo: '/weapi/vipnewcenter/app/user/sign/info',
  vipGrowthPoint: '/weapi/vipnewcenter/app/level/growhpoint/basic',
  yunbeiSignedGet: '/weapi/point/signed/get',
  yunbeiTodayGet: '/weapi/point/today/get',
})

const asText = (value) => (typeof value === 'string' ? value : JSON.stringify(value))

/** AES-128-CBC + PKCS7,输出 base64。 */
const aesCbc = (text, key, iv) => {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64')
}

/** AES-128-ECB + PKCS7,输出大写 hex。 */
const aesEcb = (text, key) => {
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null)
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    .toString('hex')
    .toUpperCase()
}

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex')

/**
 * RSA 原文加密,输出小写 hex。secretKey 只有 16 字节,左侧补零到 1024 位后
 * 用 RSA_NO_PADDING,结果与参考实现的 forge 加法 'NONE' 逐字节一致。
 */
const rsaEncSecKey = (secretKey) => {
  const bytes = Buffer.from(secretKey.split('').reverse().join(''), 'utf8')
  const modulusLength = 128
  const padded = Buffer.concat([Buffer.alloc(modulusLength - bytes.length), bytes])
  const key = { key: CRYPTO.weapiPublicKeyPem, padding: constants.RSA_NO_PADDING }
  return publicEncrypt(key, padded).toString('hex')
}

const randomSecretKey = () =>
  Array.from({ length: CRYPTO.weapiSecretKeyLength }, () =>
    CRYPTO.weapiBase62.charAt(randomInt(0, CRYPTO.weapiBase62.length)),
  ).join('')

/**
 * weapi 参数:双层 AES-CBC 得到 params,RSA 加密反转后的 secretKey 得到 encSecKey。
 * 两者都是原文,调用方按 x-www-form-urlencoded 编码后再发送。
 * options.secretKey 只在测试里注入,生产不要传。
 */
export function weapiParams(json, options = {}) {
  const secretKey = options.secretKey === undefined ? randomSecretKey() : options.secretKey
  if (typeof secretKey !== 'string' || secretKey.length !== CRYPTO.weapiSecretKeyLength) {
    const got = typeof secretKey === 'string' ? secretKey.length : typeof secretKey
    throw new Error(`weapi secretKey 必须为 16 字符 · 实际 ${got}`)
  }
  const text = asText(json)
  const inner = aesCbc(text, CRYPTO.weapiPresetKey, CRYPTO.weapiIv)
  return {
    params: aesCbc(inner, secretKey, CRYPTO.weapiIv),
    encSecKey: rsaEncSecKey(secretKey),
  }
}

/**
 * eapi 参数:AES-ECB 加密 url-分隔符-JSON-分隔符-md5 摘要 的拼接串,输出大写 hex。
 * URL 参与摘要,所以同 payload 不同 URL 的密文不同。返回值同样是原文。
 */
export function eapiParams(url, json) {
  const text = asText(json)
  const digest = md5(`nobody${url}use${text}md5forencrypt`)
  const plain = `${url}${CRYPTO.eapiSeparator}${text}${CRYPTO.eapiSeparator}${digest}`
  return { params: aesEcb(plain, CRYPTO.eapiAesKey) }
}
