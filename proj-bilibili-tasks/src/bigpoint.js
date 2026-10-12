// 大会员大积分的「补领」通道。
//
// 背景(2026-10-12 定位,证据见上游 issue #1195 的评论):
//   上游薄壳调 pgc/activity/score/task/receive/v2 只带 task_code,返回 -400/6007000。
//   该接口在仓库 bruno 抓包里是 App 形态:近 30 个设备字段 + native_api_from/bili-http-engine 等头。
//   照那个形状补齐设备字段、只用网页 cookie 请求时接口会返回 code=0,但**没有实际效果**
//   (领取前后 combine 里 state/complete_times 与积分完全不变)。
// 所以这里只在拿到 App 侧凭据(access_key 与有效的 x-bili-ticket)时才真正尝试,
// 并且**以"领取后状态是否真的变了"为成功判据** —— 接口的 code=0 不足以当成功。
import fs from 'node:fs'

export const COMBINE_URL = 'https://api.bilibili.com/x/vip_point/task/combine'
export const RECEIVE_URL = 'https://api.bilibili.com/pgc/activity/score/task/receive/v2'
// 上游 bruno 抓包里用的设备指纹,只作为「看起来像安卓客户端」的常量,不代表任何真实设备。
const DEFAULT_DEVICE_ID = 'f9abaee74692f9e9'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** 从 cookie 串里取出这次请求要用的字段(buvid3/csrf/mid 都在 cookie 里)。 */
export function readCookieFields(cookie) {
    const fields = {}
    for (const part of String(cookie ?? '').split('; ')) {
        const index = part.indexOf('=')
        if (index > 0) fields[part.slice(0, index)] = part.slice(index + 1)
    }
    return {
        cookie: String(cookie ?? ''),
        csrf: fields.bili_jct ?? '',
        buvid: fields.buvid3 ?? fields.buvid_fp ?? '',
        mid: fields.DedeUserID ?? ''
    }
}

/** 解析 combine 响应:积分 + 每个任务的 state/complete_times。state 1=待领取 3=已完成。 */
export function readBigPointState(payload) {
    const data = payload?.data ?? {}
    const modules = data?.task_info?.modules ?? []
    const tasks = []
    for (const module of modules) {
        for (const item of module?.common_task_item ?? []) {
            if (!item?.task_code) continue
            tasks.push({
                code: String(item.task_code),
                state: Number(item.state ?? 0),
                completeTimes: Number(item.complete_times ?? 0),
                title: String(item.title ?? '')
            })
        }
    }
    const point = Number.isFinite(Number(data?.point_info?.point)) ? Number(data.point_info.point) : null
    return { point, tasks }
}

/** 待领取的任务(日常任务里 state=1 且没完成过的);已完成的(state 3)不重复领。 */
export function pendingTaskCodes(tasks) {
    return tasks.filter((task) => task.state === 1 && task.completeTimes === 0).map((task) => task.code)
}

export function buildClaimBody({ fields, taskCode, accessKey, deviceTicket, deviceId = DEFAULT_DEVICE_ID }) {
    return {
        bili_local_id: deviceId,
        build: '7760700',
        buvid: fields.buvid,
        channel: 'yingyongbao',
        containerName: 'AbstractWebActivity',
        csrf: fields.csrf,
        device: 'phone',
        deviceId,
        deviceName: 'samsungNexus',
        devicePlatform: 'Android10samsungNexus',
        device_id: deviceId,
        device_name: 'samsungNexus',
        device_platform: 'Android10samsungNexus',
        disable_rcmd: '0',
        fingerprint: deviceId,
        isPad: 'false',
        localFingerprint: deviceId,
        local_id: fields.buvid,
        mobi_app: 'android',
        modelName: 'Nexus',
        networkState: '2',
        networkstate: '2',
        osVer: '10',
        platform: 'android',
        sessionID: '120548f6',
        statistics: '{"appId":1,"platform":3,"version":"7.76.0","abtest":""}',
        statusBarHeight: '77',
        taskCode,
        ...(accessKey ? { access_key: accessKey } : {})
    }
}

/** 请求头照 bruno 抓包;x-bili-ticket 只有拿到 App 凭据时才带。 */
export function buildClaimHeaders(fields, deviceTicket) {
    return {
        Cookie: fields.cookie,
        native_api_from: 'h5',
        buvid: fields.buvid,
        referer: 'https://big.bilibili.com/mobile/bigPoint/task',
        'user-agent': UA,
        'x-bili-aurora-eid': 'UlAAQFkMBVkH',
        'x-bili-mid': fields.mid,
        'bili-http-engine': 'cronet',
        ...(deviceTicket ? { 'x-bili-ticket': deviceTicket } : {})
    }
}

/** App 侧凭据文件(600,不进仓库);没有文件返回 null —— 调用方据此完全不发请求。 */
export function readAppCredentials(file) {
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
        const accessKey = typeof raw.accessKey === 'string' ? raw.accessKey.trim() : ''
        const deviceTicket = typeof raw.deviceTicket === 'string' ? raw.deviceTicket.trim() : ''
        if (!accessKey && !deviceTicket) return null
        return { accessKey, deviceTicket, deviceId: typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : DEFAULT_DEVICE_ID }
    } catch {
        return null
    }
}

async function post(fetchImpl, url, { method = 'GET', headers, body }) {
    const init = { method, headers: body ? { ...headers, 'content-type': 'application/x-www-form-urlencoded' } : headers }
    if (body) init.body = new URLSearchParams(body).toString()
    const response = await fetchImpl(url, init)
    const text = await response.text()
    return JSON.parse(text)
}

/**
 * 尝试补领。返回 null 表示「没有 App 凭据,什么都没做」。
 * 成功与否只看 combine 里的状态/积分有没有真的变化,不看接口的 code。
 */
export async function claimBigPoint({ config, cookie, deps = {} }) {
    const credentials = readAppCredentials(config.appCredentialsFile)
    if (!credentials) return null
    const fetchImpl = deps.fetchImpl ?? fetch
    const fields = readCookieFields(cookie)
    const headers = buildClaimHeaders(fields, credentials.deviceTicket)

    const before = readBigPointState(await post(fetchImpl, COMBINE_URL + '?csrf=' + fields.csrf, { headers }))
    const codes = pendingTaskCodes(before.tasks)
    if (codes.length === 0) return { attempted: 0, changed: [], gained: 0 }

    for (const code of codes) {
        try {
            await post(fetchImpl, RECEIVE_URL, {
                method: 'POST',
                headers,
                body: buildClaimBody({ fields, taskCode: code, accessKey: credentials.accessKey, deviceTicket: credentials.deviceTicket, deviceId: credentials.deviceId })
            })
        } catch {
            // 单个任务失败不影响其它任务;最终以状态对比为准
        }
    }

    const after = readBigPointState(await post(fetchImpl, COMBINE_URL + '?csrf=' + fields.csrf, { headers }))
    const key = (state) => new Map(state.tasks.map((task) => [task.code, `${task.state}/${task.completeTimes}`]))
    const beforeKeys = key(before)
    const afterKeys = key(after)
    const changed = codes.filter((code) => beforeKeys.get(code) !== afterKeys.get(code))
    const gained = before.point !== null && after.point !== null ? after.point - before.point : 0
    return { attempted: codes.length, changed, gained }
}
