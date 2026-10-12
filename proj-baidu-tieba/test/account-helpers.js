// Task 4 系列(account*.test.js)共用的路由桩与常量。不是测试文件(不匹配 *.test.js),
// 不会被 node --test 当用例跑。三个请求地址与形状来自 ../src/client.js。
import { stub } from './stub.js';

export const TBS = 'https://tieba.baidu.com/dc/common/tbs';
export const GUIDE = 'https://tieba.baidu.com/c/f/forum/forumGuide';
export const SIGN = 'https://c.tieba.baidu.com/c/c/forum/sign';
export const json = (payload) => ({ text: JSON.stringify(payload) });
export const signCalls = (calls) => calls.filter((call) => call.url === SIGN);
export const forum = (id, kw, extra = {}) => ({ forum_id: id, forum_name: kw, is_sign: 0, ...extra });
export const ZERO = { signed: 0, already: 0, blocked: 0, tbsStale: 0, failed: 0 };

/** 记录 sleep 的 deps;`route` 按 url 分派响应。 */
export function makeDeps(route) {
  const sleeps = [];
  const { calls, fetchImpl } = stub(route);
  const sleep = async (ms) => {
    sleeps.push(ms);
  };
  return { deps: { fetchImpl, sleep }, calls, sleeps };
}

/** 按 url 分派:tbs/guide 按序取数组末项兜底,sign 按 kw 取对象或函数。 */
export function route({ tbs = [{ is_login: 1, tbs: 'TBS1' }], guide = [{ like_forum: [] }], sign = {} }) {
  let tbsAt = 0;
  let guideAt = 0;
  return (url, options) => {
    if (url === TBS) return json(tbs[Math.min(tbsAt++, tbs.length - 1)]);
    if (url === GUIDE) return json(guide[Math.min(guideAt++, guide.length - 1)]);
    const body = new URLSearchParams(options.body);
    const reply = typeof sign === 'function' ? sign(body.get('kw'), body) : sign[body.get('kw')];
    // `{ throw }` / `{ status }` 是桩的传输层指令,直接透传,不能当业务响应包成 JSON。
    if (reply && (reply.throw || reply.status !== undefined)) return reply;
    return json(reply ?? { error_code: '1', error_msg: 'unexpected' });
  };
}
