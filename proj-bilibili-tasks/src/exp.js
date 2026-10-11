// 每日任务经验真值:由 `GET /x/member/web/exp/reward` 的 data 渲染(纯函数)。
// 口径(2026-10-11 真机实证):登录 5 + 观看 5 + 分享 5 + 投币经验 coins(值即使获得的经验,上限 50)。
// reward 非对象时返回 null,由调用方回落到估算口径并在消息里标注。
const EACH = 5
const FIELDS = ['login', 'watch', 'share', 'coins']

const digits = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)

export function expFromReward(reward) {
    if (!reward || typeof reward !== 'object' || Array.isArray(reward)) return null
    const done = { login: reward.login === true, watch: reward.watch === true, share: reward.share === true }
    const coins = Math.max(0, digits(reward.coins))
    const view = {
        login: done.login ? `已得 ${EACH}` : '未完成',
        watch: done.watch ? `已得 ${EACH}` : '未完成',
        share: done.share ? `已得 ${EACH}` : '未完成',
        coins: coins > 0 ? `已得 ${coins}` : '未完成',
        total: (done.login ? EACH : 0) + (done.watch ? EACH : 0) + (done.share ? EACH : 0) + coins,
        missing: [],
        estimated: false
    }
    view.missing = FIELDS.filter((name) => view[name] === '未完成')
    return view
}
