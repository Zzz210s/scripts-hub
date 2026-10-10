// 跳过原因与人工处理文案的表。文案硬规则:不用圆括号、不用 emoji、补充说明用 ` · ` 分隔。
// 静音约定:企业微信只收「需要你处理」,正常跳过无论什么原因都只写运行日志。
export const REASONS = {
    paused: { silent: true, text: '程序已手动暂停', followUp: '恢复前不会再跑' },
    'done-today': { silent: true, text: '今天已经成功跑过一次', followUp: '明天重新开始' },
    'attempts-exhausted': { silent: true, text: '今天的尝试次数已用尽', followUp: '明天重新开始' },
    'peer-running': { silent: true, text: '同伴程序正在运行', followUp: '下一次触发会再看' },
    'quiet-hours': { silent: true, text: '当前是安静时段', followUp: '安静时段结束后会再跑' },
    'before-shutdown': { silent: true, text: '临近关机时刻', followUp: '下一次触发会再看' },
    'low-memory': { silent: true, text: '可用内存不足', followUp: '下一次触发会重试' },
    'no-credentials': { silent: true, text: '还没有可用的登录凭据', followUp: '扫码登录后会开始跑' }
}

export const isSilentSkip = () => true
export const reasonText = (reason) => REASONS[reason]?.text ?? String(reason)
export const followUpText = (reason) => REASONS[reason]?.followUp ?? '下一次触发会再看'

export const ACTION_KINDS = {
    login: {
        please: '请你:在跑这个程序的机器上执行一次登录命令 node src/cli.js login,用手机 B站 App 扫它给出的二维码',
        reason: '还没有可用的登录凭据',
        consequence: '不扫码登录就不会开始自动跑 · 经验与会员券都会漏'
    },
    'cookie-invalid': {
        please: '请你:在跑这个程序的机器上重新扫码登录一次',
        reason: 'Cookie 已失效 · 登录态接口返回未登录',
        consequence: '不重新登录就不会再自动跑 · 经验与会员券都会漏'
    },
    'risk-blocked': {
        please: '请你:暂时什么都不用做,等账号级风控自行解除',
        reason: 'B站返回了账号级风控标记',
        consequence: '风控期间部分任务会失败 · 重试也不会恢复'
    }
}

export const actionText = (kind) => ACTION_KINDS[kind] ?? ACTION_KINDS['cookie-invalid']
