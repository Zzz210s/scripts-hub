// 会员判定(纯):nav 响应 -> {tier, isVip, notLoggedIn}。
// 关键规则(设计文档 §7.1):只有 vipStatus === 1 时 vipType 才有效。
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null)
const pick = (source, keys) => {
    for (const key of keys) if (source?.[key] !== undefined) return source[key]
    return undefined
}

export function memberFromNav(nav) {
    const root = nav && typeof nav === 'object' ? nav : {}
    const data = root.data && typeof root.data === 'object' ? root.data : root
    const extra = {
        couponBalance: num(pick(data?.wallet ?? {}, ['coupon_balance', 'couponBalance'])),
        money: num(pick(data ?? {}, ['money'])),
        level: num(pick(data?.level_info ?? {}, ['current_level', 'currentLevel']))
    }

    if (data.isLogin !== true) return { tier: 'none', isVip: false, notLoggedIn: true, ...extra }

    const vipStatus = num(pick(data, ['vipStatus', 'vip_status']))
    const vipType = num(pick(data, ['vipType', 'vip_type']))
    if (vipStatus !== 1) return { tier: 'none', isVip: false, notLoggedIn: false, ...extra }
    if (vipType === 2) return { tier: 'annual', isVip: true, notLoggedIn: false, ...extra }
    if (vipType === 1) return { tier: 'monthly', isVip: true, notLoggedIn: false, ...extra }
    return { tier: 'none', isVip: false, notLoggedIn: false, ...extra }
}
