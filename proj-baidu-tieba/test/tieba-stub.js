// run/cli 集成测试共用的完整贴吧协议桩(不匹配 *.test.js,不会被 node --test 当用例跑)。
// 2026-10-14 起协议形状按真机实测:会话与关注列表都来自 `GET /mo/q/newmoindex`。
//
// `accounts` 键为 cookie 串,值为 { ok?: false, forums: [{ fid, kw, isSign?, isForbidden? }],
//   honorSign?: false 该账号的签到不计入已签,sessionFailAt?: [n] 第 n 次会话请求回 500 }。
// `honorSign: false`(顶层)模拟「第一层说成功但读回 is_sign 仍为 0」的谎报,用来驱动对账不通过。
import { stub } from './stub.js';

export const SESSION_URL = 'https://tieba.baidu.com/mo/q/newmoindex';
export const SIGN_URL = 'https://c.tieba.baidu.com/c/c/forum/sign';

const json = (payload, status = 200) => ({ status, text: JSON.stringify(payload) });

/** newmoindex 的成功形状:uid + itb_tbs + like_forum[]。 */
export function sessionBody({ tbs = 'TBS1', uid = '1000000000', forums = [], no = 0, error = 'success' } = {}) {
  return { no, error, data: no === 0 ? { uid, tbs: tbs.slice(-16), itb_tbs: tbs, like_forum: forums } : undefined };
}

export function tiebaStub({ accounts = {}, honorSign = true, tbs = 'TBS1' } = {}) {
  const signed = new Set();
  const seen = { session: [], sign: [] };
  const { calls, fetchImpl } = stub((url, options) => {
    const cookie = options?.headers?.Cookie ?? '';
    const account = accounts[cookie];
    if (url === SESSION_URL) {
      seen.session.push(cookie);
      if (!account || account.ok === false) return json(sessionBody({ forums: [], no: 1, error: '未登录' }));
      // sessionFailAt 按「第几次会话请求」精确失败:一次运行里会话要被请求多次
      // (体检 → 签到时取会话 → 签完读回),测试要能只打断中间那一次。
      if ((account.sessionFailAt ?? []).includes(seen.session.length)) {
        return json({ error: '会话暂时不可用' }, 500);
      }
      const forums = (account.forums ?? []).map((forum) => ({
        forum_id: forum.fid,
        forum_name: forum.kw,
        is_sign: signed.has(`${cookie}|${forum.kw}`) || forum.isSign === true ? 1 : 0,
        is_forbidden: forum.isForbidden === true ? 1 : 0,
      }));
      return json(sessionBody({ tbs, forums }));
    }
    const body = new URLSearchParams(options.body);
    const kw = body.get('kw');
    seen.sign.push({ cookie, kw });
    if (honorSign && account.honorSign !== false) signed.add(`${cookie}|${kw}`);
    return json({ error_code: '0', user_info: { is_sign_in: 1, sign_bonus_point: 3 } });
  });
  return { fetchImpl, calls, seen, signed };
}
