// 贴吧等级门槛:每个吧的 `user_exp` 是**累计经验**,`user_level` 由它落在哪一档决定。
//
// 门槛表本身是天文数字式的常数,没法从接口反推 —— 但可以用真机数据校验:
// 2026-10-30 拿 136 个关注吧的 `(level, exp)` 逐条比对,四种等级(5/6/7/8)
// 与 [50,100,200,500,1000] 这几档**零违反**,所以这张表是可信的。
//
// 用途只有一个:算出「这个吧离下一级还差多少经验」,再决定今天值得为它花几条回帖。

/** 升到该等级所需的累计经验。索引即等级。 */
const LEVEL_MIN_EXP = [
  0, // 0 占位,方便按下标取
  0, 5, 15, 30, 50, 100, 200, 500, 1000, 2000,
  3000, 6000, 10000, 18000, 30000, 60000, 100000, 300000, 500000, 1000000
];

const MAX_LEVEL = LEVEL_MIN_EXP.length - 1;

/** 等级与经验都可能是字符串或 null,统一转成整数;转不了给 null,绝不拿 0 顶替。 */
function toInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && Number.isInteger(parsed) ? parsed : null;
}

/**
 * 升到该等级需要多少累计经验。等级非法返回 null,方便调用方区分「不知道」与「0」。
 */
export function levelThreshold(level) {
  const lv = toInt(level);
  if (lv === null || lv < 1 || lv > MAX_LEVEL) return null;
  return LEVEL_MIN_EXP[lv];
}

/**
 * 距下一级还差多少经验。
 *
 * 返回:
 *   正整数 —— 还差这么多;
 *   0      —— 已在最高等级,再攒也没用;
 *   null   —— 等级或经验不可用,调用方应**跳过**这个吧,而不是当成 0 或猜一个数。
 */
export function gapToNextLevel(level, exp) {
  const lv = toInt(level);
  const current = toInt(exp);
  if (lv === null || current === null || lv < 1) return null;
  // 越界的等级要判「不知道」而不是「已满级」:21 级不存在,说成 0 会让计划层以为无须再发。
  if (lv > MAX_LEVEL) return null;
  if (lv === MAX_LEVEL) return 0;
  const next = LEVEL_MIN_EXP[lv + 1];
  return Math.max(0, next - current);
}

export { LEVEL_MIN_EXP, MAX_LEVEL };
