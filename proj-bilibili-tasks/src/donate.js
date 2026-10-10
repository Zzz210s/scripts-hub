// 投币策略(纯):余额与保留值决定今天投几枚。余额不足一律「跳过」,不是失败。
export function coinTarget({ balance, threshold = 0, max = 5 } = {}) {
    const b = Number(balance)
    if (!Number.isFinite(b) || b <= 0) return { target: 0, stop: true, reason: 'balance-zero' }
    if (b <= threshold) return { target: 0, stop: true, reason: 'below-threshold' }
    return { target: Math.min(max, Math.floor(b - threshold)), stop: false, reason: null }
}
