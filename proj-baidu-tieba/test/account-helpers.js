// Task 4 系列(account*.test.js)共用的路由桩与常量。不是测试文件(不匹配 *.test.js),
// 不会被 node --test 当用例跑。请求地址与形状来自 ../src/client.js(2026-10-14 真机校正)。
import { stub } from './stub.js';

export const SESSION = 'https://tieba.baidu.com/mo/q/newmoindex';
export const SIGN = 'https://c.tieba.baidu.com/c/c/forum/sign';
export const json = (payload, status = 200) => ({ status, text: JSON.stringify(payload) });
export const signCalls = (calls) => calls.filter((call) => call.url === SIGN);
// 默认带一个等级(真机 `user_level` 是字符串);传 `user_level: null` 可测「等级取不到」。
export const forum = (id, kw, extra = {}) => ({ forum_id: id, forum_name: kw, is_sign: 0, user_level: '8', ...extra });
export const ZERO = { signed: 0, already: 0, blocked: 0, tbsStale: 0, failed: 0 };

/** 一次成功的会话响应(uid + itb_tbs + like_forum)。 */
export const sessionOk = ({ tbs = 'TBS1', forums = [], uid = '1000000000' } = {}) => ({
  no: 0,
  error: 'success',
  data: { uid, tbs: tbs.slice(-16), itb_tbs: tbs, like_forum: forums },
});

/** 凭据失效的会话响应:文案里带「登录」,client 据此归 auth。 */
export const sessionAuthFail = () => ({ no: 1, error: '未登录' });

/** 记录 sleep 的 deps;`route` 按 url 分派响应。 */
export function makeDeps(route) {
  const sleeps = [];
  const { calls, fetchImpl } = stub(route);
  const sleep = async (ms) => {
    sleeps.push(ms);
  };
  return { deps: { fetchImpl, sleep }, calls, sleeps };
}

/**
 * 按 url 分派:会话按序取数组末项兜底,sign 按 kw 取对象或函数。
 * `session` 的每一项都是一整份响应体(见 sessionOk / sessionAuthFail)。
 */
export function route({ session = [sessionOk()], sign = {} } = {}) {
  let at = 0;
  return (url, options) => {
    if (url === SESSION) return json(session[Math.min(at++, session.length - 1)]);
    const body = new URLSearchParams(options.body);
    const reply = typeof sign === 'function' ? sign(body.get('kw'), body) : sign[body.get('kw')];
    // `{ throw }` / `{ status }` 是桩的传输层指令,直接透传,不能当业务响应包成 JSON。
    if (reply && (reply.throw || reply.status !== undefined)) return reply;
    return json(reply ?? { error_code: '1', error_msg: 'unexpected' });
  };
}
