// run/cli 集成测试共用的完整贴吧协议桩(不匹配 *.test.js,不会被 node --test 当用例跑)。
// `accounts` 键为 cookie 串,值为 { ok?: false, forums: [{ fid, kw, isSign?, isForbidden? }] }。
// `honorSign: false` 模拟「第一层说成功但读回 is_sign 仍为 0」的谎报,用来驱动对账不通过。
import { stub } from './stub.js';

export const TBS_URL = 'https://tieba.baidu.com/dc/common/tbs';
export const GUIDE_URL = 'https://tieba.baidu.com/c/f/forum/forumGuide';
export const SIGN_URL = 'https://c.tieba.baidu.com/c/c/forum/sign';

const json = (payload) => ({ text: JSON.stringify(payload) });

export function tiebaStub({ accounts = {}, honorSign = true, tbs = 'TBS1' } = {}) {
  const signed = new Set();
  const seen = { tbs: [], guide: [], sign: [] };
  const { calls, fetchImpl } = stub((url, options) => {
    const cookie = options?.headers?.Cookie ?? '';
    const account = accounts[cookie];
    if (url === TBS_URL) {
      seen.tbs.push(cookie);
      if (!account || account.ok === false) return json({ is_login: 0, tbs: null });
      return json({ is_login: 1, tbs });
    }
    if (!account || account.ok === false) return json({ is_login: 0, like_forum: [] });
    if (url === GUIDE_URL) {
      seen.guide.push(cookie);
      const forums = (account.forums ?? []).map((forum) => ({
        forum_id: forum.fid,
        forum_name: forum.kw,
        is_sign: signed.has(`${cookie}|${forum.kw}`) || forum.isSign === true ? 1 : 0,
        is_forbidden: forum.isForbidden === true ? 1 : 0,
      }));
      return json({ like_forum: forums, like_forum_has_more: 0 });
    }
    const body = new URLSearchParams(options.body);
    const kw = body.get('kw');
    seen.sign.push({ cookie, kw });
    if (honorSign) signed.add(`${cookie}|${kw}`);
    return json({ error_code: '0', user_info: { sign_bonus_point: 3 } });
  });
  return { fetchImpl, calls, seen, signed };
}
