// Task 3 测试共用的 fetchImpl 桩。不是测试文件(不匹配 *.test.js),不会被 node --test 当用例跑。
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** 记录调用的 fetchImpl 桩;`reply(url, options)` 返回 { status, text } 或 { throw: Error }。 */
export function stub(reply) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const result = reply(url, options);
    if (result.throw) throw result.throw;
    return {
      ok: result.status === undefined || result.status < 400,
      status: result.status ?? 200,
      text: async () => result.text,
    };
  };
  return { calls, fetchImpl };
}

/** 固定 JSON 响应的 reply。 */
export const jsonReply = (payload) => () => ({ text: JSON.stringify(payload) });

/** 读夹具原文。 */
export const loadText = (name) =>
  readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');
