// 跳过原因与人工处理文案的表。文案硬规则见 docs/notification-convention.md:
// 不用圆括号、不用 emoji、补充说明用 ` · ` 分隔;此处只放「为什么」与「会怎样」的原句。
export const REASONS = {
    'nothing-new': { silent: true, text: '本期限免已全部领过', followUp: '下一次触发会再看' },
    'already-attempted': { silent: true, text: '今天的尝试次数已用尽', followUp: '明天重新开始' },
    'peer-running': { silent: true, text: '同伴程序正在运行', followUp: '下一次触发会再看' },
    'quiet-hours': { silent: true, text: '当前是安静时段', followUp: '安静时段结束后会再跑' },
    'low-memory': { silent: false, text: '可用内存不足', followUp: '下一次触发会重试' },
    'probe-failed': { silent: false, text: '读免费游戏清单失败', followUp: '下一次触发会重试' },
    paused: { silent: false, text: '程序已手动暂停', followUp: '恢复前不会再跑' }
}

export const isSilentSkip = (reason) => REASONS[reason]?.silent === true
export const reasonText = (reason) => REASONS[reason]?.text ?? String(reason)
export const followUpText = (reason) => REASONS[reason]?.followUp ?? '下一次触发会再看'

export const ACTION_KINDS = {
    captcha: {
        please: '请你:在浏览器里打开下面的链接完成结账',
        reason: '结账时遇到 hCaptcha 人机验证',
        consequence: '验证通过前领不到,这个周期结束后不能补领'
    },
    login: {
        please: '请你:在本机跑 node src/cli.js login,打开它给出的链接完成一次登录',
        reason: 'Epic 登录令牌已失效或被吊销',
        consequence: '不重新登录就无法自动领取,这个周期结束后不能补领'
    },
    'auth-network': {
        please: '请你:无需操作,程序会在下一次触发时自动重试;若一直失败就跑 node src/cli.js login',
        reason: '续期登录令牌时网络失败',
        consequence: '本轮没领到,下一次触发会再试,这个周期结束后不能补领'
    },
    blocked: {
        please: '请你:手动去商店页看看这款游戏',
        reason: '自动领取没有成功',
        consequence: '这个周期结束后不能补领'
    }
}

export const actionText = (kind) => ACTION_KINDS[kind] ?? ACTION_KINDS.captcha
