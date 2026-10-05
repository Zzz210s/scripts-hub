// 路径与环境:项目根、上游引擎、数据、日志、凭据文件。默认值全在本目录内,可被环境变量覆盖。
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '..')

const int = (value, fallback) => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback
}

export function loadConfig(env = process.env) {
    const root = env.EPIC_DIR ? path.resolve(env.EPIC_DIR) : ROOT
    const vendorDir = path.join(root, 'vendor', 'free-games-claimer')
    return {
        root,
        vendorDir,
        engineScript: path.join(vendorDir, 'epic-games.js'),
        vendorDbFile: path.join(vendorDir, 'data', 'epic-games.json'),
        dataDir: path.join(root, 'data'),
        stateFile: path.join(root, 'data', 'state.json'),
        browserDir: path.join(root, 'data', 'browser'),
        logsDir: path.join(root, 'logs'),
        secretsDir: path.join(root, 'secrets'),
        tokensFile: env.EPIC_TOKENS_FILE || path.join(root, 'secrets', 'epic-tokens.json'),
        webhookFile: env.WECOM_WEBHOOK_FILE || path.join(root, 'secrets', 'wecom-webhook.txt'),
        locale: env.EPIC_LOCALE || 'zh-CN',
        country: env.EPIC_COUNTRY || 'CN',
        maxAttemptsPerDay: int(env.EPIC_MAX_ATTEMPTS, 1),   // 2026-10-05:人机验证多由"登录尝试过多"触发,降为每天 1 次
        engineTimeoutMinutes: int(env.EPIC_ENGINE_TIMEOUT_MINUTES, 30),
        busyPeers: String(env.EPIC_BUSY_PEERS || '').split(',').map((s) => s.trim()).filter(Boolean),
        dryRun: env.EPIC_DRY_RUN === '1'
    }
}
