// 离线单测:weapi / eapi 加密纯函数。不发任何网络请求,不含任何真实凭据。
// 固定向量按参考实现 api-enhanced 的 util/crypto.js 算法(基线 90de6414)生成,
// 用的工具是 crypto-js 4.2.0 + node-forge 1.3.1,并用 OpenSSL 3.5.5 独立复核。
import test from 'node:test'
import assert from 'node:assert/strict'
import { weapiParams, eapiParams, CRYPTO, PATHS } from '../src/crypto.js'

const SK_A = 'abcdefghijklmnop'
const SK_B = 'Zz9AaBbCcDdEeFf1'
const HEX_UPPER = /^[0-9A-F]+$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

test('weapi 固定 secretKey 得到固定向量', () => {
  assert.deepEqual(weapiParams({ test: 'test' }, { secretKey: SK_A }), {
    params: 'VF097+2K+EwiexNFX4FFupM1Y7CzPE5jVVcZdDZQZb0=',
    encSecKey:
      'd15a1683c992095d0c234c19966605c5c5964911268bbeda8cb8d08d834913e5' +
      '9d53b32358903a121b5fca784c1f5ae44951fd02524df58ecc98e52cc7cf8689' +
      'b42c2e93ddf05b0592512d87f5960467e2f086c018849d76014d323500e30f13' +
      'ef4cafbb0cf5a66731a3f1776c75ca35d0062dac70a3e33245afabcf47938487',
  })
})

test('weapi 换一个 payload 与 secretKey 仍是固定向量', () => {
  assert.deepEqual(
    weapiParams({ signDayTime: 1700000000000, type: 1 }, { secretKey: SK_B }),
    {
      params:
        'BbKFG7GLaUAFiChL6iQbNIOpofVpo7sSuiGT9odpwvFXoXpDjGa90yneRC/HMFIU' +
        'b1zJOZtm2bHR8D8FkItWjU+uN81rjMm6Iu6NTIcucEY=',
      encSecKey:
        '1cc416d2cfc89e21a0058de9767c9c58d1c0b5263d1585b26c201bc751b2fb5d' +
        '454e8293de94e9c64fb8d739f5a9e45b00923403d1c27480a2b5575999574101' +
        '3950556533c7f8fec85124de3358932cbdb12ae7660ce4fa76f5b7358528176c' +
        'fc28a343e61d94dcbf80a8d16be005f22d029b5290622d943df5fd285548b288',
    },
  )
})

test('weapi 默认 secretKey 每次随机', () => {
  const a = weapiParams({ k: 'v' })
  const b = weapiParams({ k: 'v' })
  assert.notEqual(a.params, b.params)
  assert.match(a.encSecKey, /^[0-9a-f]{256}$/)
  assert.match(a.params, BASE64)
})

test('weapi 拒绝长度不为 16 的 secretKey,文案无圆括号', () => {
  assert.throws(() => weapiParams({}, { secretKey: 'short' }), (err) => {
    assert.equal(err.message.includes('('), false)
    assert.match(err.message, /16/)
    return true
  })
})

test('eapi 固定向量:URL 参与摘要,输出大写 hex', () => {
  const url = '/api/vipnewcenter/app/level/user/checkin/history/detail'
  const out = eapiParams(url, { signDayTime: 1700000000000, type: 1 })
  assert.deepEqual(out, {
    params:
      'E422E21FE1C070374FA6D7A8393DDEC2ED97FD2EC324E8E3B7BB732434535F4F' +
      'C587F341F28425647A9FB58D2AB4F7C5E14D621EB896C63E8E0FBC1DFA867E56' +
      '6784A253A01DB24530DF8336582F4CC4443DCCEDE55892A6F739E5D44F007D43' +
      'D9B22F27D01CA0B90677BB0A11E4D15EB005FCCE467CAE575D6D25BD2D3A9EBF' +
      '09775E2D7D4462F93294872C1944276B00731E665A87F4CAD5295723AFC3EE63',
  })
  assert.match(out.params, HEX_UPPER)
})

test('eapi 第二个固定向量:短 payload 与另一个 URL', () => {
  assert.equal(
    eapiParams('/api/point/dailyTask', { type: 0 }).params,
    '04F1A0AB8150EFD085BC839891D19E2E488A2D6C2924C5589260A62E82B1A0D3' +
      '269E35676914DE6AB39EE35E5EA8509727BAC46D25C857431F0F9F7B929A5A29' +
      'D0199063D15FDD185B6784D2D02CA66700351E36F40398F6C23E4B9330875256',
  )
})

test('eapi 的密文随 URL 变化', () => {
  const body = { type: 1 }
  assert.notEqual(
    eapiParams('/api/point/dailyTask', body).params,
    eapiParams('/api/point/dailyTaskX', body).params,
  )
})

test('params 是未编码原文,表单编码由调用方按 x-www-form-urlencoded 处理', () => {
  const { params, encSecKey } = weapiParams({ test: 'test' }, { secretKey: SK_A })
  assert.ok(params.includes('+') && params.endsWith('='))
  const body = new URLSearchParams({ params, encSecKey }).toString()
  assert.ok(body.includes('%2B'))
  assert.ok(body.includes('%3D'))
  assert.equal(new URLSearchParams(body).get('params'), params)
})

test('常量与路径集中导出且不可变', () => {
  assert.ok(Object.isFrozen(CRYPTO) && Object.isFrozen(PATHS))
  assert.equal(CRYPTO.weapiPresetKey, '0CoJUm6Qyw8W8jud')
  assert.equal(CRYPTO.weapiIv, '0102030405060708')
  assert.equal(CRYPTO.eapiAesKey, 'e82ckenh8dichen8')
  assert.equal(CRYPTO.eapiSeparator, '-36cd479b6b5-')
  assert.match(CRYPTO.weapiPublicKeyPem, /^-----BEGIN PUBLIC KEY-----/)
  assert.equal(PATHS.vipSign, '/weapi/vip-center-bff/task/sign')
  assert.equal(
    PATHS.vipCheckinDetail,
    '/eapi/vipnewcenter/app/level/user/checkin/history/detail',
  )
})

test('入参 undefined 或 null 当空对象:导出函数直调也不抛', () => {
  assert.deepEqual(
    weapiParams(undefined, { secretKey: SK_A }),
    weapiParams({}, { secretKey: SK_A }),
  )
  assert.deepEqual(eapiParams('/api/point/dailyTask'), eapiParams('/api/point/dailyTask', {}))
  assert.deepEqual(eapiParams('/api/point/dailyTask', null), eapiParams('/api/point/dailyTask', {}))
})

test('入参对象不被修改', () => {
  const body = { signDayTime: 1, type: 1 }
  eapiParams('/api/point/dailyTask', body)
  weapiParams(body, { secretKey: SK_A })
  assert.deepEqual(body, { signDayTime: 1, type: 1 })
})
