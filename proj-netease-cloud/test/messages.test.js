// T8:四类消息渲染的离线单测。纯函数,不发请求、不落盘、不读时钟。
// 回归重点:业务未生效时消息里绝不能出现「成功」二字 —— 失败必须读起来像失败。
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAction, buildResult, buildSkip, buildStart, byteLength, PROGRAM } from '../src/messages.js'
import { REASONS, safeText } from '../src/message-text.js'

const ACCOUNT = { id: 'acct-1', name: '账号 1' }
const DATE = '2026-10-11'
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/u
const PAREN = /[()（）]/
const FORBIDDEN = new RegExp(`${EMOJI.source}|${PAREN.source}`, 'u')

const VIP_OK = { ok: true, step: 'done', businessOk: true }
const YUNBEI = { ok: true, balance: 130, signedToday: true }

test('buildStart:四段式标题含程序名、账号、日期与动作', () => {
  const text = buildStart({ date: DATE, account: ACCOUNT })
  assert.equal(text, `${PROGRAM} · 账号 1 · ${DATE} · 开始运行`)
})

test('buildStart:多账号时显示账号数,单个账号显示名字', () => {
  assert.match(buildStart({ date: DATE, accounts: [ACCOUNT, { name: '账号 2' }] }), / · 2 个账号 · /)
  assert.match(buildStart({ date: DATE, account: { name: '' } }), / · 账号未知 · /)
})

test('buildResult:businessOk=true 含 VIP 乐签结论与云贝行,标题是运行成功', () => {
  const text = buildResult({ date: DATE, account: ACCOUNT, vip: VIP_OK, yunbei: YUNBEI })
  assert.match(text, /运行成功$|运行成功/)
  assert.match(text, /VIP 乐签:已确认/)
  assert.match(text, /云贝:余额 130 · 今日已签/)
})

test('buildResult:businessOk=false 时不得出现「成功」,结论为未生效', () => {
  const text = buildResult({
    date: DATE,
    account: ACCOUNT,
    vip: { ok: false, step: 'checkin', businessOk: false, reason: 'http', error: '接口返回失败 · code 500' },
    yunbei: YUNBEI,
  })
  assert.equal(text.includes('成功'), false)
  assert.match(text, /VIP 乐签:未生效/)
  assert.match(text, /原因:接口返回失败/)
})

test('buildResult:businessOk=null 渲染「未能确认」,同样不出现「成功」', () => {
  const text = buildResult({ date: DATE, account: ACCOUNT, vip: { ok: false, step: 'sign' }, yunbei: YUNBEI })
  assert.equal(text.includes('成功'), false)
  assert.match(text, /VIP 乐签:未能确认/)
})

test('buildResult:云贝不可用时如实写「暂不可用」,不崩不谎报', () => {
  const text = buildResult({ date: DATE, account: ACCOUNT, vip: VIP_OK, yunbei: { ok: false } })
  assert.match(text, /云贝:暂不可用/)
})

test('buildResult:有基线且两次都有数字时给出相对变化', () => {
  const text = buildResult({
    date: DATE,
    account: ACCOUNT,
    vip: VIP_OK,
    yunbei: YUNBEI,
    baseline: { yunbei: 100, growthPoint: 3 },
  })
  assert.match(text, /相对基线 \+30/)
  // 没有基线就不写这一行,更不编 0。
  assert.equal(buildResult({ date: DATE, account: ACCOUNT, vip: VIP_OK, yunbei: YUNBEI }).includes('相对基线'), false)
  assert.equal(
    buildResult({ date: DATE, account: ACCOUNT, vip: VIP_OK, yunbei: { ok: true }, baseline: { yunbei: 100 } }).includes('相对基线'),
    false,
  )
})

test('buildResult:dryRun 是预览,不与业务结论混为一谈', () => {
  const text = buildResult({ date: DATE, account: ACCOUNT, vip: VIP_OK, yunbei: YUNBEI, dryRun: true })
  assert.match(text, /预览,未运行/)
  assert.match(text, /没有落盘 · 没有发送/)
})

test('buildResult:非零退出码写进结论行', () => {
  const text = buildResult({ date: DATE, account: ACCOUNT, vip: { businessOk: false }, yunbei: YUNBEI, exitCode: 1 })
  assert.match(text, /退出码:1/)
})

test('buildSkip:原因、后续与需要做什么三段齐全', () => {
  const text = buildSkip({ date: DATE, account: ACCOUNT, reason: 'quiet-hours' })
  assert.match(text, /原因:当前是安静时段/)
  assert.match(text, /后续:安静时段结束后会再跑/)
  assert.match(text, /你需要做什么:不需要/)
})

test('buildAction:凭据类原因给出「请你」与「不处理的后果」', () => {
  const text = buildAction({ date: DATE, account: ACCOUNT, reason: 'credentials-invalid' })
  assert.match(text, /请你:重新登录网易云音乐/)
  assert.match(text, /不处理的后果:/)
  // 账号级错误细节会附在下面
  const withDetail = buildAction({
    date: DATE,
    account: { ...ACCOUNT, error: '未登录或凭据已失效 · code 301' },
    reason: 'credentials-invalid',
  })
  assert.match(withDetail, /细节:账号 1 · 未登录或凭据已失效/)
})

test('buildSkip/buildAction:未知原因码显式兜底,不渲染成 undefined', () => {
  const text = buildSkip({ date: DATE, account: ACCOUNT, reason: 'wat' })
  assert.match(text, /未识别的跳过原因:wat/)
  const action = buildAction({ date: DATE, account: ACCOUNT, reason: 'wat' })
  assert.match(action, /未识别的处理原因:wat/)
})

test('四类消息:动态文本带圆括号或 emoji 时也要消毒干净', () => {
  const dirty = { id: 'acct-2', name: '测试(小号)🎵' }
  const texts = [
    buildStart({ date: DATE, account: dirty }),
    buildResult({ date: DATE, account: dirty, vip: VIP_OK, yunbei: { ok: false } }),
    buildSkip({ date: DATE, account: dirty, reason: 'paused' }),
    buildAction({ date: DATE, account: dirty, reason: 'rate-limit' }),
    buildResult({ date: DATE, account: ACCOUNT, vip: { businessOk: false, error: '坏(坏)🎵' }, yunbei: { ok: false } }),
  ]
  for (const text of texts) assert.equal(FORBIDDEN.test(text), false, text)
})

test('safeText:括号换空格、去 emoji、收敛分隔符与空白', () => {
  assert.equal(safeText('测试(小号)🎵'), '测试 小号')
  assert.equal(safeText('a（）b'), 'a b')
  assert.equal(safeText('  x · · y  '), 'x · y')
  assert.equal(safeText(undefined), '')
})

test('REASONS 覆盖守卫与处理矩阵的全部机器码', () => {
  for (const code of [
    'ok',
    'paused',
    'done-today',
    'circuit-broken',
    'attempts-exhausted',
    'peer-running',
    'quiet-hours',
    'before-shutdown',
    'low-memory',
    'no-credentials',
    'credentials-invalid',
    'auth',
    'rate-limit',
    'shape',
    'network',
  ]) {
    assert.ok(REASONS[code], `缺少原因码 ${code}`)
    assert.ok(REASONS[code].text && REASONS[code].followUp, `原因码 ${code} 文案不全`)
  }
})

test('超长正文按 UTF-8 字节截断,且不超过企业微信上限', () => {
  const accounts = Array.from({ length: 40 }, (_, i) => ({ id: `acct-${i}`, name: `账号 ${i}` }))
  const text = buildResult({
    date: DATE,
    accounts,
    vip: VIP_OK,
    yunbei: YUNBEI,
    reason: 'shape',
  })
  assert.ok(byteLength(text) <= 2048)
  assert.match(text, /已省略/)
})
