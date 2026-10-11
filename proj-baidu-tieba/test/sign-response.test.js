// Task 2:签到响应解析与第一层判定的测试。
// 夹具在 test/fixtures/,字段形状与返回码的出处见 ../../NOTICE。
// 全部离线:没有任何网络请求。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  SIGN_STATUS,
  judgeSign,
  parseSignResponse,
  statusCountsKey,
} from '../src/sign.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const loadJson = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));
const loadText = (name) => readFileSync(path.join(FIXTURES, name), 'utf8');

test('SIGN_STATUS 的取值是钉死的五个字符串', () => {
  assert.deepEqual(SIGN_STATUS, {
    SIGNED: 'signed',
    ALREADY: 'already',
    BLOCKED: 'blocked',
    TBS_STALE: 'tbs-stale',
    FAILED: 'failed',
  });
});

test('statusCountsKey 只把 tbs-stale 映射成驼峰', () => {
  assert.equal(statusCountsKey(SIGN_STATUS.TBS_STALE), 'tbsStale');
  assert.equal(statusCountsKey(SIGN_STATUS.SIGNED), 'signed');
  assert.equal(statusCountsKey(SIGN_STATUS.ALREADY), 'already');
  assert.equal(statusCountsKey(SIGN_STATUS.BLOCKED), 'blocked');
  assert.equal(statusCountsKey(SIGN_STATUS.FAILED), 'failed');
});

test('夹具 sign-ok:error_code 0 且 user_info 说明真签进去了', () => {
  const parsed = parseSignResponse(loadJson('sign-ok.json'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.code, 0);
  assert.equal(parsed.errno, 0);
  assert.equal(parsed.bonusPoint, 8);
  assert.equal(parsed.isSignIn, '1');
  assert.equal(judgeSign(parsed), SIGN_STATUS.SIGNED);
});

test('parseSignResponse 接受未解析的响应文本', () => {
  const parsed = parseSignResponse(loadText('sign-ok.json'));
  assert.equal(parsed.ok, true);
  assert.equal(judgeSign(parsed), SIGN_STATUS.SIGNED);
  assert.equal(parsed.raw.user_info.sign_bonus_point, 8);
});

test('夹具 sign-bonus-only:只有 sign_bonus_point 也判成功', () => {
  const parsed = parseSignResponse(loadJson('sign-bonus-only.json'));
  assert.equal(parsed.isSignIn, '0');
  assert.equal(parsed.bonusPoint, 5);
  assert.equal(judgeSign(parsed), SIGN_STATUS.SIGNED);
});

test('夹具 sign-already:160002 判已签过,不计失败', () => {
  const parsed = parseSignResponse(loadJson('sign-already.json'));
  assert.equal(parsed.code, 160002);
  assert.equal(judgeSign(parsed), SIGN_STATUS.ALREADY);
});

test('夹具 sign-blocked:340006 判不可签', () => {
  const parsed = parseSignResponse(loadJson('sign-blocked.json'));
  assert.equal(parsed.code, 340006);
  assert.equal(judgeSign(parsed), SIGN_STATUS.BLOCKED);
});

test('回归:error_code 0 但嵌套 error.errno 320022 必须判 tbs-stale', () => {
  const parsed = parseSignResponse(loadJson('sign-tbs-stale.json'));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, 0);
  assert.equal(parsed.errno, 320022);
  assert.equal(judgeSign(parsed), SIGN_STATUS.TBS_STALE);
});

test('嵌套 errno 优先于顶层 error_code', () => {
  const parsed = parseSignResponse({
    error_code: '160002',
    error: { errno: 320022 },
    user_info: { is_sign_in: '1', sign_bonus_point: 8 },
  });
  assert.equal(judgeSign(parsed), SIGN_STATUS.TBS_STALE);
});

test('夹具 sign-nested-unknown:非 320022 的嵌套错误判失败', () => {
  const parsed = parseSignResponse(loadJson('sign-nested-unknown.json'));
  assert.equal(parsed.errno, 110001);
  assert.equal(judgeSign(parsed), SIGN_STATUS.FAILED);
});

test('夹具 sign-no-userinfo:error_code 0 但没有 user_info 判失败', () => {
  const parsed = parseSignResponse(loadJson('sign-no-userinfo.json'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.bonusPoint, null);
  assert.equal(parsed.isSignIn, null);
  assert.equal(judgeSign(parsed), SIGN_STATUS.FAILED);
});

test('user_info 在但两个字段都说明没签成,判失败', () => {
  const parsed = parseSignResponse({
    error_code: '0',
    user_info: { is_sign_in: '0', sign_bonus_point: 0 },
  });
  assert.equal(judgeSign(parsed), SIGN_STATUS.FAILED);
});

test('is_sign_in 为数字 1 也认(协议里两种写法都出现过)', () => {
  const parsed = parseSignResponse({ error_code: '0', user_info: { is_sign_in: 1 } });
  assert.equal(parsed.isSignIn, '1');
  assert.equal(judgeSign(parsed), SIGN_STATUS.SIGNED);
});

test('非法 JSON 不抛异常,判失败', () => {
  const parsed = parseSignResponse('{"error_code": "0", broken');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, null);
  assert.equal(parsed.raw, null);
  assert.equal(judgeSign(parsed), SIGN_STATUS.FAILED);
});

test('非对象输入不抛异常,判失败', () => {
  for (const body of [null, undefined, 42, 'null', '[]']) {
    const parsed = parseSignResponse(body);
    assert.equal(parsed.ok, false);
    assert.equal(judgeSign(parsed), SIGN_STATUS.FAILED);
  }
});

test('缺失的 error_code 不抛异常,判失败', () => {
  const parsed = parseSignResponse({ error: { errno: '' }, user_info: {} });
  assert.equal(parsed.code, null);
  assert.equal(parsed.errno, null);
  assert.equal(judgeSign(parsed), SIGN_STATUS.FAILED);
});

test('judgeSign 收到垃圾输入不抛异常', () => {
  assert.equal(judgeSign(null), SIGN_STATUS.FAILED);
  assert.equal(judgeSign(undefined), SIGN_STATUS.FAILED);
  assert.equal(judgeSign({}), SIGN_STATUS.FAILED);
});

test('error 是空串或普通字符串时不抛异常,也不当成嵌套错误', () => {
  const bodies = [
    { error_code: '0', error: '', user_info: { is_sign_in: '1' } },
    { error_code: '0', error: 'success', user_info: { sign_bonus_point: 3 } },
  ];
  for (const body of bodies) {
    const parsed = parseSignResponse(body);
    assert.equal(parsed.errno, null);
    assert.equal(judgeSign(parsed), SIGN_STATUS.SIGNED);
  }
});
