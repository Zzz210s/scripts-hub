// 逐吧明细消息:结果消息之后再单发一条,一个吧一行 `吧名 Lv8`,按等级从高到低排。
//
// 为什么不塞进结果消息:真机上一个账号 136 个已关注吧,挤进去会把对账结论挤出 2048 字节。
// 纯函数 —— 不发送、不落盘、不读时钟;分段与字节预算都在这里算完,发送由调用方做。
//
// 硬规则与四类消息一致:不用圆括号、不用 emoji;数字只来自接口(`user_level` 取不到写 `Lv?`)。
import { SEP, safeText } from './message-text.js';
import { SIGN_STATUS } from './sign.js';

export const PROGRAM = '百度贴吧签到';
// 单条上限:企业微信文本是 2048 字节,这里留出续页标记的余量 —— 单条恒 ≤1840 字节。
export const LIMIT_BYTES = 1840;
// 最宽的续页后缀,用它预留预算(` · 续 99/99`),实际后缀不会更宽。
const WIDEST_SUFFIX = `${SEP}续 99/99`;

const byteLength = (text) => Buffer.byteLength(text, 'utf8');

/** 状态 -> 明细分组。未知状态按失败算:宁可说失败,也不要让某个吧从明细里消失。 */
function groupOf(status) {
  if (status === SIGN_STATUS.SIGNED || status === SIGN_STATUS.ALREADY) return 'signed';
  if (status === SIGN_STATUS.BLOCKED) return 'blocked';
  return 'failed';
}

/** 失败原因只说状态本身,不带堆栈;`tbs 失效` 与普通失败分开写。 */
const failWord = (status) => (status === SIGN_STATUS.TBS_STALE ? 'tbs 失效' : '失败');

/** 等级:接口给的是整数就 `Lv8`,取不到写 `Lv?` —— 不拿经验值或其它数字顶替。 */
const levelText = (level) => `Lv${Number.isInteger(level) ? level : '?'}`;

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

/** 单账号的一段:已签(含已签过)/ 不可签 / 失败 三小段,空的那段整段不出现。 */
function accountLines(account, { multi, maxForums }) {
  const rows = Array.isArray(account?.results) ? account.results : [];
  if (!rows.length) return [];
  const groups = { signed: [], blocked: [], failed: [] };
  for (const row of rows) groups[groupOf(row?.status)].push(row);
  groups.signed.sort(compareSigned);

  const lines = [];
  if (multi) lines.push(`账号 ${safeText(account?.name) || '未命名'}`);

  if (groups.signed.length) {
    lines.push(`已签 ${groups.signed.length} 个`);
    const listed = groups.signed.slice(0, maxForums);
    for (const row of listed) lines.push(`${nameOf(row)} ${levelText(row.level)}`);
    const hidden = groups.signed.length - listed.length;
    if (hidden > 0) lines.push(`另有 ${hidden} 个未列出`);
  }
  if (groups.blocked.length) {
    lines.push(`不可签 ${groups.blocked.length} 个`);
    for (const row of groups.blocked) lines.push(nameOf(row));
  }
  if (groups.failed.length) {
    lines.push(`失败 ${groups.failed.length} 个`);
    for (const row of groups.failed) lines.push(`${nameOf(row)}${SEP}${failWord(row?.status)}`);
  }
  return lines;
}

/** 单行超预算时按字符截断(不劈开码点),补省略标记。 */
function clipLine(line, budget) {
  if (byteLength(line) <= budget) return line;
  const marker = '...';
  let out = '';
  for (const char of line) {
    if (byteLength(out + char) + byteLength(marker) > budget) break;
    out += char;
  }
  return `${out}${marker}`;
}

/** 按字节预算灌页:整行搬移,不把某一行切成两半;标题在每页都出现。 */
function paginate(title, lines) {
  const budget = LIMIT_BYTES - byteLength(title) - byteLength(WIDEST_SUFFIX) - 2;
  const pages = [];
  let current = [];
  let used = 0;
  for (const line of lines) {
    const text = clipLine(line, budget - 1);
    const size = byteLength(text) + 1;
    if (used + size > budget && current.length) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(text);
    used += size;
  }
  if (current.length) pages.push(current);
  const total = pages.length;
  return pages.map((page, index) => {
    // 多段时每段都标 `续 i/n`,收到哪一段都知道还有没有下一段。
    const head = total > 1 ? `${title}${SEP}续 ${index + 1}/${total}` : title;
    return [head, '', ...page].join('\n');
  });
}

/**
 * 渲染逐吧明细消息(可能多条)。
 *
 * @param {{ date?: string, accounts?: Array<{name?: string, results?: Array<{
 *   kw?: unknown, level?: number|null, status?: string }>}>, maxForums?: number }} [input]
 * @returns {string[]} 每条都是一个可直接发送的消息;没有可列的吧时返回空数组。
 */
export function buildDetailMessages({ date, accounts = [], maxForums = 200 } = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  const multi = list.length > 1;
  const limit = Number.isInteger(maxForums) && maxForums > 0 ? maxForums : 200;
  const lines = [];
  for (const account of list) lines.push(...accountLines(account, { multi, maxForums: limit }));
  if (!lines.length) return [];
  const title = `${PROGRAM}${SEP}${safeText(date) || '日期未知'}${SEP}签到明细`;
  return paginate(title, lines);
}
