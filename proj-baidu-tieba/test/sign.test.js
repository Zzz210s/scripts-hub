// Task 1:签名与参数构造的纯函数测试。协议出处见 ../NOTICE。
// 期望值是两个硬编码的 md5 字面量(不是用同一份实现算出来的),否则测不出拼接形式。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CLIENT_FIELDS,
  SIGN_SALT,
  buildSignParams,
  canonicalQuery,
  signQuery,
} from '../src/sign.js';

test('salt 是协议事实 tiebaclient!!!', () => {
  assert.equal(SIGN_SALT, 'tiebaclient!!!');
});

test('canonicalQuery 按 key 升序直接拼接 k=v,不带分隔符', () => {
  assert.equal(canonicalQuery({ a: '1', b: '2' }), 'a=1b=2');
  // ASCII 升序:大写字母 < 下划线 < 小写字母
  assert.equal(canonicalQuery({ b: '2', a: '1', _c: '3' }), '_c=3a=1b=2');
  assert.equal(canonicalQuery({}), '');
});

test('signQuery 是 拼接串 + salt 的 md5 大写', () => {
  assert.equal(signQuery({ a: '1', b: '2' }), '42961B9881C2D7CB297E9498F9767789');
});

test('signQuery 与 key 的传入顺序无关', () => {
  assert.equal(signQuery({ b: '2', a: '1' }), signQuery({ a: '1', b: '2' }));
});

test('buildSignParams 带齐必需参数与客户端伪装字段', () => {
  const params = buildSignParams({
    bduss: 'BDUSS_SAMPLE',
    fid: '12345',
    kw: '测试吧',
    tbs: 'TBS_SAMPLE',
    timestamp: '1700000000',
  });
  assert.equal(params.BDUSS, 'BDUSS_SAMPLE');
  assert.equal(params.fid, '12345');
  assert.equal(params.kw, '测试吧');
  assert.equal(params.tbs, 'TBS_SAMPLE');
  assert.equal(params.timestamp, '1700000000');
  for (const [k, v] of Object.entries(DEFAULT_CLIENT_FIELDS)) {
    assert.equal(params[k], v, `缺少客户端字段 ${k}`);
  }
});

test('buildSignParams 的 sign 覆盖全部参数(含伪装字段),且可复现', () => {
  const params = buildSignParams({
    bduss: 'BDUSS_SAMPLE',
    fid: '12345',
    kw: '测试吧',
    tbs: 'TBS_SAMPLE',
    timestamp: '1700000000',
  });
  assert.equal(params.sign, 'FEDB92A6B87CC9AAE830770E08368532');
  const { sign, ...rest } = params;
  assert.equal(signQuery(rest), sign);
  assert.equal(
    canonicalQuery(rest),
    Object.keys(rest)
      .sort()
      .map((k) => `${k}=${rest[k]}`)
      .join(''),
  );
});

test('数值型入参统一转成字符串,参与签名的是同一份值', () => {
  const params = buildSignParams({
    bduss: 'B',
    fid: 12345,
    kw: 'k',
    tbs: 't',
    timestamp: 1700000000,
  });
  assert.equal(params.fid, '12345');
  assert.equal(params.timestamp, '1700000000');
  const { sign, ...rest } = params;
  assert.equal(signQuery(rest), sign);
});

test('clientFields 可覆盖默认伪装字段,并可追加自定义字段', () => {
  const params = buildSignParams({
    bduss: 'B',
    fid: '1',
    kw: 'k',
    tbs: 't',
    timestamp: '2',
    clientFields: { model: 'CUSTOM', extra: 'x' },
  });
  assert.equal(params.model, 'CUSTOM');
  assert.equal(params.extra, 'x');
  assert.equal(params._client_version, DEFAULT_CLIENT_FIELDS._client_version);
  const { sign, ...rest } = params;
  assert.equal(signQuery(rest), sign);
  assert.ok(canonicalQuery(rest).includes('extra=x'));
});

test('默认字段不可被就地改动(冻结)', () => {
  assert.throws(() => {
    DEFAULT_CLIENT_FIELDS.model = 'CHANGED';
  }, TypeError);
});
