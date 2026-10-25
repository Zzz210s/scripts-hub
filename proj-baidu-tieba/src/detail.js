// 逐吧明细段:并进**结果消息**里(不再单发第二条),每个等级一行 `Lv8 吧A 吧B`,等级从高到低。
//
// 为什么分组而不是一行一个吧:2026-10-25 真机实测,一个账号关注 136 个吧 ——
//   `吧名 Lv8` 逐行 = 2038 字节,加上账号统计与对账结论就超了 2048 的单条上限;
//   `Lv8 吧A 吧B …` 分组 = 1514 字节,既能列全 136 个吧又能标出等级。
// 预算不够时从**等级最低的组开始整组丢**,末尾写一行还差多少个,结论行永远不被动到。
//
// 硬规则:不用圆括号、不用 emoji;等级只来自接口 `user_level`,取不到写 `Lv?`。
import { SEP, safeText } from './message-text.js';
import { SIGN_STATUS } from './sign.js';

// 一行至少能放一个吧名 + 等级前缀;低于这个值就不值得列明细了。
export const MIN_LINE_BUDGET = 120;
// 单行上限:再长也难读,超过就换行(换行不丢信息,丢信息只发生在整组被丢时)。
const MAX_LINE_BUDGET = 900;

const byteLength = (text) => Buffer.byteLength(text, 'utf8');

/** 状态 -> 分组。未知状态按失败算:宁可说失败,也不要让某个吧从明细里消失。 */
function groupOf(status) {
  if (status === SIGN_STATUS.SIGNED || status === SIGN_STATUS.ALREADY) return 'signed';
  if (status === SIGN_STATUS.BLOCKED) return 'blocked';
  return 'failed';
}

/** 失败原因只说状态本身,不带堆栈;`tbs 失效` 与普通失败分开写。 */
const failWord = (status) => (status === SIGN_STATUS.TBS_STALE ? 'tbs 失效' : '失败');

/** 等级:接口给的是整数就 `Lv8`,取不到写 `Lv?` —— 不拿经验值或其它数字顶替。 */
const levelText = (level) => `Lv${Number.isInteger(level) ? level : '?'}`;
const levelKey = (level) => (Number.isInteger(level) ? level : null);
const nameOf = (row) => safeText(row?.kw) || '未命名吧';

/** 等级高的在前;同等级按吧名码点排序(跨机器稳定,不依赖 ICU 区域设置)。 */
function compareSigned(left, right) {
  const a = Number.isInteger(left?.level) ? left.level : -1;
  const b = Number.isInteger(right?.level) ? right.level : -1;
  if (a !== b) return b - a;
  const x = nameOf(left);
  const y = nameOf(right);
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

/** 按字符截到字节预算内(不劈开码点),超了补省略标记。 */
function clipName(name, budget) {
  if (byteLength(name) <= budget) return name;
  const marker = budget > 4 ? '...' : '';
  let out = '';
  for (const char of name) {
    if (byteLength(out + char) + byteLength(marker) > budget) break;
    out += char;
  }
  return `${out}${marker}`;
}

/** 同一等级的吧名装进若干行,每行都以 `LvN ` 开头;超宽换行,单个吧名超宽截断。 */
function wrapGroup(level, names, lineLimit) {
  const prefix = `${levelText(level)} `;
  const room = Math.max(8, lineLimit - byteLength(prefix) - 1);
  const lines = [];
  let current = prefix;
  for (const raw of names) {
    const name = clipName(raw, room);
    const candidate = current === prefix ? `${prefix}${name}` : `${current} ${name}`;
    if (byteLength(candidate) > lineLimit && current !== prefix) {
      lines.push(current);
      current = `${prefix}${name}`;
      continue;
    }
    current = candidate;
  }
  if (current !== prefix) lines.push(current);
  return lines;
}

const blockBytes = (lines) => lines.reduce((sum, line) => sum + byteLength(line) + 1, 0);

/**
 * 渲染逐吧明细段(纯函数,不发消息)。
 *
 * @param {Array<{name?: string, results?: Array<{kw?: unknown, level?: unknown, status?: string}>}>} accounts
 * @param {{ maxForums?: number, budget?: number }} [options] `budget` 是本段可用的字节预算
 * @returns {{ lines: string[], listed: number, total: number, dropped: number }}
 */
export function renderForumSection(accounts, options = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  const limit = Number.isInteger(options.maxForums) && options.maxForums > 0 ? options.maxForums : 200;
  const budget = Number.isFinite(options.budget) ? Math.max(0, Math.floor(options.budget)) : Infinity;
  const multi = list.length > 1;

  const fixed = [];   // 不可签 / 失败 / 多账号标题:少而重要,放前面,预算不够也不先丢
  const groups = [];  // [{ level, names }],跨账号按等级合并
  let total = 0;

  for (const account of list) {
    const rows = Array.isArray(account?.results) ? account.results : [];
    if (!rows.length) continue;
    if (multi) fixed.push(`账号 ${safeText(account?.name) || '未命名'}`);
    const signed = [];
    for (const row of rows) {
      const kind = groupOf(row?.status);
      if (kind === 'blocked') fixed.push(`不可签 ${nameOf(row)}`);
      else if (kind === 'failed') fixed.push(`失败 ${nameOf(row)}${SEP}${failWord(row?.status)}`);
      else {
        total += 1;
        signed.push(row);
      }
    }
    const alreadyListed = groups.reduce((sum, group) => sum + group.names.length, 0);
    const kept = signed.sort(compareSigned).slice(0, Math.max(0, limit - alreadyListed));
    for (const row of kept) {
      const key = levelKey(row.level);
      const bucket = groups.find((one) => one.level === key);
      if (bucket) bucket.names.push(nameOf(row));
      else groups.push({ level: key, names: [nameOf(row)] });
    }
  }

  if (!fixed.length && !groups.length) return { lines: [], listed: 0, total, dropped: total };

  // 等级高的在前;等级未知的排在最后
  groups.sort((left, right) => (right.level ?? -1) - (left.level ?? -1));
  const sizes = groups.map((group) => group.names.length);
  const lineLimit = Math.min(budget === Infinity ? Infinity : Math.max(MIN_LINE_BUDGET, budget), MAX_LINE_BUDGET);
  const rendered = groups.map((group, index) => wrapGroup(group.level, group.names, lineLimit));
  const listedBefore = (keep) => sizes.slice(0, keep).reduce((sum, size) => sum + size, 0);

  // 从「全都列」开始,装不下就从最低等级整组丢,直到装得下(或者一组都不留)
  for (let keep = rendered.length; keep >= 0; keep -= 1) {
    const listed = listedBefore(keep);
    const dropped = total - listed;
    const body = [...fixed];
    for (let index = 0; index < keep; index += 1) body.push(...rendered[index]);
    if (dropped > 0) body.push(`另有 ${dropped} 个未列出 · 按等级从高到低`);
    if (blockBytes(body) <= budget) {
      // 一组都列不下、也没有不可签/失败要说 —— 不如不列,别只发一行「另有 N 个」
      if (keep === 0 && fixed.length === 0) return { lines: [], listed: 0, total, dropped: total };
      return { lines: body, listed, total, dropped };
    }
  }
  return { lines: [], listed: 0, total, dropped: total };
}
