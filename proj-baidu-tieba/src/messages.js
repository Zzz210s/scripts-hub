// Task 8:四类消息渲染。纯函数 —— 不发送、不落盘、不读时钟。
// 硬规则:不用圆括号(全角半角都不行)、不用 emoji,补充说明一律 ` · ` 分隔,
// 标题四段式 `<程序名> · <账号或账号数> · <日期> · <动作>`。
// 数字一律来自入参的接口数据,本文件不估算、不聚合、不补零。
// 长度护栏:企业微信文本上限 2048 字节(UTF-8),标题与正文都可能超长,
// 超出按整行截断、标题补省略标记并保留结论行。

export const PROGRAM = '百度贴吧签到';
export const LIMIT_BYTES = 2048;

import { REASONS, SEP, accountFailText, actionText, followUpText, reasonText, reconcileText, safeText } from './message-text.js';

// 词表在 message-text.js;这里原样转出,调用方与测试只需认 messages.js 一个入口。
export { REASONS, accountFailText, actionText, followUpText, reasonText } from './message-text.js';

/** UTF-8 字节数;企业微信的限制按字节算,不是字符数。 */
export const byteLength = (text) => Buffer.byteLength(text, 'utf8');

/** 按字符截到字节预算内(不劈开码点)。 */
function clipTo(text, budget) {
  if (byteLength(text) <= budget) return text;
  let out = '';
  for (const char of text) {
    if (byteLength(out + char) > budget) break;
    out += char;
  }
  return out;
}

/** 超长动态标题截断并补省略标记 —— 截断处不能看起来像完整的账号名。 */
function clipHead(head, budget) {
  if (byteLength(head) <= budget) return head;
  const marker = budget > 4 ? '...' : '';
  return clipTo(head, budget - byteLength(marker)) + marker;
}

/** 只认有限数字;null / undefined / '' / NaN 一律当「没取到」,不编 0。 */
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const accountLabel = (accounts) => {
  if (!Array.isArray(accounts)) return '账号数未知';
  if (accounts.length === 1 && safeText(accounts[0]?.name)) return safeText(accounts[0].name);
  return `${accounts.length} 个账号`;
};

const headline = (accounts, date, action) => [PROGRAM, accountLabel(accounts), date ? safeText(date) : '日期未知', action].join(SEP);

// 计数键 -> 文案。只渲染接口给出的数字,缺键少一段,绝不补 0。
const COUNT_LABEL = { signed: '已签', already: '已签过', blocked: '不可签', tbsStale: 'tbs 失效', failed: '失败' };

function countParts(counts) {
  const parts = [];
  for (const [key, label] of Object.entries(COUNT_LABEL)) {
    const value = num(counts?.[key]);
    if (value !== null) parts.push(`${label} ${value}`);
  }
  return parts;
}

const verifyWord = (item) => (item?.ok === true ? '通过' : item?.ok === false ? '未通过' : '未能核对');
const nameList = (items) => (Array.isArray(items) ? items.map(safeText).filter(Boolean) : []);

/** 逐账号一行(按传入顺序,不排序),解释行用两个空格缩进跟在对应账号下面。 */
function accountLines(accounts, reconcile) {
  const perAccount = Array.isArray(reconcile?.perAccount) ? reconcile.perAccount : null;
  const lines = [];
  for (const item of Array.isArray(accounts) ? accounts : []) {
    // 匹配用原始账号名,显示才消毒 —— 否则带圆括号的账号名会对不上对账条目
    const verified = perAccount ? perAccount.find((one) => one?.name === item?.name) : undefined;
    const name = safeText(item?.name) || '未命名';
    const parts = countParts(item?.counts);
    if (perAccount) parts.push(`对账 ${verifyWord(verified)}`);
    lines.push(`账号 ${name}${parts.length ? SEP + parts.join(SEP) : ''}`);
    if (item?.emptyForums) lines.push('  关注列表为空,本次没有可签的吧');
    if (item?.incompleteForums) lines.push('  关注列表被截断,可能还有没签的吧');
    if (item?.ok === false) lines.push(`  原因:${safeText(item?.error) || accountFailText(item?.reason)}`);
    const missing = nameList(verified?.missing);
    if (missing.length) lines.push(`  未签:${missing.join(SEP)}`);
    const blocked = nameList(verified?.blocked);
    if (blocked.length) lines.push(`  不可签:${blocked.join(SEP)}`);
  }
  return lines;
}

const countPart = (label, value) => { const parsed = num(value); return parsed === null ? null : `${label} ${parsed}`; };
const joinParts = (...parts) => parts.filter(Boolean).join(SEP);

/** 对账结论(结论行,截断时必须保留)。三态各自说清「接下来怎样」。 */
function reconcileLines(reconcile) {
  if (reconcile === null || reconcile === undefined || typeof reconcile !== 'object') return ['对账:未提供'];
  const listed = Array.isArray(reconcile.reasons) && reconcile.reasons.length ? reconcile.reasons : [reconcile.reason];
  // 三个标记位即使没进 reasons 也要说清 —— 它们各自都足以判失败
  const flags = [
    ...(reconcile.truncated ? ['truncated'] : []),
    ...(reconcile.emptyForums ? ['empty-forums'] : []),
    ...(reconcile.expectedEmpty ? ['expected-empty'] : []),
    ...(nameList(reconcile.unresolvedAccounts).length ? ['list-failed'] : [])
  ];
  const why = [...new Set([...listed, ...flags].map(reconcileText))].join(SEP);
  const unresolved = nameList(reconcile.unresolvedAccounts);
  const pending = unresolved.length ? [`  未能核对:${unresolved.join(SEP)}`] : [];
  const tail = joinParts(countPart('未签', reconcile.missingTotal), countPart('不可签', reconcile.blockedTotal));
  if (reconcile.ok === true) return [`对账:通过${tail ? SEP + tail : ''}`, '后续:今天已完成,明天重新开始'];
  if (reconcile.ok === false) {
    return [`对账:未通过${tail ? SEP + tail : ''}`, `  原因:${why}`, ...pending, '后续:下一次触发会自动重试;连续失败时再请你处理'];
  }
  return [`对账:未能核对${SEP}${why}`, ...pending, '后续:下一次触发会重新核对,不把今天当作已完成'];
}

/** 按 UTF-8 字节预算拼装:超限时整行丢弃正文并加省略标记,结论行始终保留。 */
function assemble(head, body, foot) {
  const join = (title, lines) => [title, '', ...lines].join('\n');
  // 标题里也有动态文本(账号名 / 日期)—— 先截断它,并给结论行留出位置,
  // 否则超长标题会把「结论永不先掉」的保证挤爆。
  const footText = foot.join('\n');
  const footReserve = Math.min(byteLength(footText), LIMIT_BYTES - 64);
  head = clipHead(head, LIMIT_BYTES - 2 - footReserve);
  if (byteLength(join(head, [...body, ...foot])) <= LIMIT_BYTES) return join(head, [...body, ...foot]);
  const kept = [];
  for (const line of body) {
    const marker = `...已省略 ${body.length - kept.length - 1} 行`;
    if (byteLength(join(head, [...kept, line, marker, ...foot])) > LIMIT_BYTES) break;
    kept.push(line);
  }
  const dropped = body.length - kept.length;
  const lines = dropped > 0 ? [...kept, `...已省略 ${dropped} 行`] : kept;
  lines.push(...foot);
  const out = join(head, lines);
  if (byteLength(out) <= LIMIT_BYTES) return out;
  // 极端:结论行本身就超限 —— 保标题,其余按字符截断。
  return `${head}\n\n${clipTo(footText, Math.max(0, LIMIT_BYTES - byteLength(head) - 2))}`;
}

export function buildStart({ date, accounts } = {}) {
  return clipHead(headline(accounts, date, '开始运行'), LIMIT_BYTES);
}

export function buildResult({ date, accounts, reconcile, exitCode, dryRun } = {}) {
  const action = dryRun === true ? '预览,未运行' : reconcile?.ok === true ? '运行成功' : '运行有失败';
  const head = headline(accounts, date, action);
  // 预览没有真的签到,也就没有对账可言 —— 不把 reconcile 混进逐账号行。
  if (dryRun === true) return assemble(head, accountLines(accounts, null), ['模式:预览,未运行 · 没有落盘 · 没有发送']);
  const foot = reconcileLines(reconcile);
  const code = num(exitCode);
  if (code !== null && code !== 0) foot.push(`退出码:${code}`);
  return assemble(head, accountLines(accounts, reconcile), foot);
}

export function buildSkip({ date, accounts, reason } = {}) {
  const head = headline(accounts, date, '正常跳过');
  // 动作类原因(不处理就永远不跑)若被误路由到 skip,也不能谎称「不需要」处理。
  const needsYou = REASONS[reason]?.action?.please?.replace(/^请你:/, '');
  return assemble(head, [], [
    `原因:${reasonText(reason)}`,
    `后续:${followUpText(reason)}`,
    `你需要做什么:${needsYou ?? '不需要'}`
  ]);
}

export function buildAction({ date, accounts, reason } = {}) {
  const { please, reason: why, consequence } = actionText(reason);
  const lines = [please, `原因:${why}`, `不处理的后果:${consequence}`];
  for (const item of (Array.isArray(accounts) ? accounts : []).filter((one) => safeText(one?.error))) {
    lines.push(`  细节:${safeText(item.name) || '未命名'}${SEP}${safeText(item.error)}`);
  }
  return assemble(headline(accounts, date, '需要你处理'), [], lines);
}
