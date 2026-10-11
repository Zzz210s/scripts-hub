// B币券流程:先查状态,该领才领,领后自证再回读 nav 拿真正入账的余额。
// 从 run.js 拆出以保持单文件职责与行数上限;判定逻辑仍在 voucher.js(纯)。
import { memberFromNav } from './member.js'
import { voucherDecision } from './voucher.js'

export async function handleVoucher({ deps, credential, member, day, log }) {
    const skip = (action, extra = {}) => ({
        result: { action, tier: member.tier, count: 0, ...extra, balance: extra.balance ?? member.couponBalance },
        history: { day, action, state: extra.state ?? null, expireTime: extra.expireTime ?? null, nextReceiveDays: extra.nextReceiveDays ?? null }
    })
    if (member.tier !== 'annual') {
        log('[券] 非年度大会员,跳过 B币券')
        return skip('skipped-none')
    }
    if (!credential.csrf) {
        log('[券] cookie 里没有 bili_jct,跳过')
        return { ...skip('unknown'), failure: { kind: 'voucher-no-csrf', label: '缺少 csrf', note: '会员券 · cookie 里没有 bili_jct · 未领取', ignored: true } }
    }
    const first = await deps.fetchVoucher(credential.cookie)
    const decision = voucherDecision(first.ok ? first.data : null)
    if (!decision.shouldReceive) {
        const action = decision.alreadyReceived ? 'already' : (first.ok ? 'skipped-none' : 'unknown')
        log(`[券] 不领取 · state=${decision.state}`)
        return skip(action, { state: decision.state, expireTime: decision.expireTime, nextReceiveDays: decision.nextReceiveDays })
    }
    await deps.receiveVoucher(credential.cookie, credential.csrf)
    const again = await deps.fetchVoucher(credential.cookie)
    const verified = voucherDecision(again.ok ? again.data : null)
    const received = verified.alreadyReceived
    log(`[券] 领取${received ? '成功' : '未自证'}`)
    // 领取后重新取 nav,拿真正入账的券余额(早先那份是领取前的旧值)
    const after = await deps.fetchNav(credential.cookie)
    const balance = after.ok ? memberFromNav(after.data).couponBalance : member.couponBalance
    return skip(received ? 'received' : 'unknown', {
        count: decision.count,
        balance,
        state: verified.state,
        expireTime: verified.expireTime,
        nextReceiveDays: verified.nextReceiveDays
    })
}
