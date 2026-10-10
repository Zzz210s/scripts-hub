// B币券状态判定(纯)。类型 1 = B币券;只有 state === 1 才代表已领取。
// state 语义未验证:只按「非 1 且已知才领」的保守口径实现,未知值一律不领。
const pick = (source, keys) => {
    for (const key of keys) if (source?.[key] !== undefined) return source[key]
    return undefined
}
const int = (value) => (Number.isFinite(Number(value)) ? Number(value) : null)

export function voucherDecision(myJson) {
    const root = myJson && typeof myJson === 'object' ? myJson : {}
    const data = root.data && typeof root.data === 'object' ? root.data : root
    const list = Array.isArray(data.list) ? data.list : []
    const coupons = list.filter((item) => int(pick(item ?? {}, ['type'])) === 1)

    if (!coupons.length) {
        return { shouldReceive: false, alreadyReceived: false, state: null, nextReceiveDays: null, expireTime: null, count: 0 }
    }

    const first = coupons[0]
    const state = int(pick(first, ['state']))
    const count = coupons.filter((item) => int(pick(item, ['state'])) !== 1).length
    const alreadyReceived = coupons.some((item) => int(pick(item, ['state'])) === 1)
    return {
        shouldReceive: count > 0 && (state === 0 || state === 2),
        alreadyReceived,
        state,
        nextReceiveDays: int(pick(first, ['next_receive_days', 'nextReceiveDays'])),
        expireTime: int(pick(first, ['expire_time', 'expireTime'])),
        count
    }
}
