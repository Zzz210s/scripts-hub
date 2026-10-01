// 逻辑日规则的测试(node --test 运行)。
//
//   cd %REWARDS_DIR%
//   node --test scripts\windows\run-state.test.js
//
// 背景:2026-09-24 凌晨 02:19 的一次补跑把"2026-09-24"写成已完成,
// 当天 11:30 开机后的所有触发都被跳过。逻辑日以本地 04:00 为界修掉这个坑。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-state.js')

/** 以指定"现在"调用 helper 的 clock 子命令,返回 { realDay, logicalDay, clock }。 */
function clockAt(iso) {
    const out = execFileSync(process.execPath, [HELPER, 'clock'], {
        encoding: 'utf8',
        env: { ...process.env, REWARDS_NOW: iso }
    }).trim()
    const [realDay, logicalDay, clock] = out.split(/\s+/)
    return { realDay, logicalDay, clock }
}

test('凌晨 02:19 的运行归到前一天(09-24 事故的复现)', () => {
    const { realDay, logicalDay, clock } = clockAt('2026-09-24T02:19:27')
    assert.equal(realDay, '2026-09-24')
    assert.equal(logicalDay, '2026-09-23', '凌晨运行必须算前一天,否则会把新的一天标记成已完成')
    assert.equal(clock, '02:19:27')
})

test('03:59 仍算前一天,04:00 起算新的一天(与 04:00 关机对齐)', () => {
    assert.equal(clockAt('2026-09-24T03:59:59').logicalDay, '2026-09-23')
    assert.equal(clockAt('2026-09-24T04:00:00').logicalDay, '2026-09-24')
})

test('开机后的白天运行算当天(09-24 11:29 开机的那次)', () => {
    assert.equal(clockAt('2026-09-24T11:33:25').logicalDay, '2026-09-24')
})

test('跨月与跨年边界', () => {
    assert.equal(clockAt('2026-10-01T01:30:00').logicalDay, '2026-09-30')
    assert.equal(clockAt('2027-01-01T02:00:00').logicalDay, '2026-12-31')
})

test('clock 的输出始终是三个字段', () => {
    assert.equal(clockAt('2026-09-24T12:00:07').clock.length, 8)
})
