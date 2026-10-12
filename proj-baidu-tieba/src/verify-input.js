// Task 5 的输入整理:决定「对账哪几个账号」「每个账号的读回列表」「missing 里写什么标签」。
// 与判定逻辑分开,好让 verify.js 保持在 200 行内;这些解析规则也值得单独测
// (映射里缺条目、条目形状不对、并集里多出账号)。
//
// 约定:`resultsByAccount` 必须是**对象**,键为账号名 —— 传数组会被 Object.keys 变成
// "0"/"1",账号名就错了。`forumsAfter` 收两种形态,见 listFor。

/** 非 null 且非数组的对象。 */
export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 单个列表项是否长得像 fetchFollowedForums 的返回。 */
export function isListResult(value) {
  return isRecord(value) && ('forums' in value || 'ok' in value);
}

/**
 * 取某账号的对账列表。`forumsAfter` 两种形态都收:
 *   - 单个列表结果   -> 所有账号共用这一份(设计文档写「重新取一次」时的形态)
 *   - 按账号名的映射 -> 每个账号各自的读回列表(设计文档「每个账号多一次列表请求」)
 * 取不到(缺条目 / 形状不对)返回 null 或一个 ok:false 的结果,由调用方判为「未知」。
 */
export function listFor(forumsAfter, name) {
  if (isListResult(forumsAfter)) return forumsAfter;
  if (!isRecord(forumsAfter)) return null;
  const entry = forumsAfter[name];
  if (entry === undefined || entry === null) return null;
  if (isListResult(entry)) return entry;
  return {
    ok: false,
    forums: null,
    count: 0,
    hasMore: false,
    error: '对账列表形状不可用',
    reason: 'parse',
  };
}

/** 账号名集合:两份数据的键的并集(列表映射里多出的账号也要报)。 */
export function accountNames(resultsByAccount, forumsAfter) {
  const names = new Set();
  if (isRecord(resultsByAccount)) {
    for (const name of Object.keys(resultsByAccount)) names.add(name);
  }
  if (isRecord(forumsAfter) && !isListResult(forumsAfter)) {
    for (const name of Object.keys(forumsAfter)) names.add(name);
  }
  return [...names];
}

/**
 * missing / blocked 里的可读标签:优先 kw,拿不到就退到 fid,都拿不到给一句固定说明。
 * 绝不把 null 直接写进面向用户的消息。本文件所有文案都不用圆括号。
 */
export function labelOf(forum) {
  if (!isRecord(forum)) return forum === null ? '未知吧' : String(forum);
  const kw = typeof forum.kw === 'string' && forum.kw.length > 0 ? forum.kw : null;
  if (kw !== null) return kw;
  const fid = forum.fid ?? forum.forumId ?? null;
  return fid === null ? '未知吧 fid 缺失' : `fid:${fid}`;
}
