// 路径与环境:项目根、状态、凭据、Console 入口、阈值。默认值全在本目录内,可被环境变量覆盖。
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '..')

const int = (value, fallback) => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback
}
const nonNeg = (value, fallback) => {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback
}

export function loadConfig(env = process.env) {
    const root = env.BILIBILI_DIR ? path.resolve(env.BILIBILI_DIR) : ROOT
    return {
        root,
        dataDir: path.join(root, 'data'),
        stateFile: env.BILIBILI_STATE_FILE || path.join(root, 'data', 'state.json'),
        lockFile: path.join(root, 'data', 'run.lock'),   // 固定路径:少一个能让锁失灵的旋钮
        logsDir: path.join(root, 'logs'),
        secretsDir: path.join(root, 'secrets'),
        cookiesFile: env.BILIBILI_COOKIES_FILE || path.join(root, 'secrets', 'cookies.json'),
        webhookFile: env.BILIBILI_WEBHOOK_FILE || path.join(root, 'secrets', 'wecom-webhook.txt'),
        consoleDir: env.BILIBILI_CONSOLE_DIR || '/app',
        consoleDll: env.BILIBILI_CONSOLE_DLL || '/app/Ray.BiliBiliTool.Console.dll',
        upstreamImage: env.BILIBILI_IMAGE || 'automation-bilibili:local',
        upstreamCommit: env.BILIBILI_UPSTREAM_COMMIT || '2db0fc613f',
        coinKeep: nonNeg(env.BILIBILI_COIN_KEEP, 20),       // coinTarget 的 threshold
        coinMax: int(env.BILIBILI_COIN_MAX, 1),             // 每天最多投几枚;用户 2026-10-28 定为 1
        // 每次 B站 API 请求前的随机等待上限(秒)。上游默认 5;实测 2.5-5 秒的节奏会让
        // /x/web-interface/view 在机房 IP 上被判 -412 request was banned(2026-10-28),
        // 放宽到 10 秒(随机 5-10)可以提高投币任务的通过率,代价是单次运行多几分钟。
        intervalSeconds: int(env.BILIBILI_INTERVAL_SECONDS, 10),
        consoleTimeoutMinutes: int(env.BILIBILI_CONSOLE_TIMEOUT_MINUTES, 20),
        maxAttempts: int(env.BILIBILI_MAX_ATTEMPTS, 3),  // 与三次触发对齐:投币会被间歇 -412 拦,多一次机会
        dayBoundaryHour: nonNeg(env.BILIBILI_DAY_BOUNDARY_HOUR, 4),
        minFreeMb: int(env.BILIBILI_FREE_MEM_MB, 800),
        // App 侧凭据(大积分「补领」用)。没有这个文件就完全不尝试,消息也不变。
        appCredentialsFile: env.BILIBILI_APP_CREDENTIALS_FILE || path.join(root, 'secrets', 'bilibili-app.json'),
        quietStart: env.BILIBILI_QUIET_START || '20:00',
        quietEnd: env.BILIBILI_QUIET_END || '23:00',
        shutdownTime: env.BILIBILI_SHUTDOWN_TIME || '02:00',
        busyPeers: String(env.BILIBILI_BUSY_PEERS || '').split(',').map((s) => s.trim()).filter(Boolean),
        dryRun: env.BILIBILI_DRY_RUN === '1'
    }
}
