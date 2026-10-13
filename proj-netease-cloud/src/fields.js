// VIP 乐签(src/vip.js)与云贝查询(src/yunbei.js)共用「今日是否已签」的候选字段表。
// 两处读同一语义但属不同接口,故只保留这一份真源:T3 实测后若字段分叉,在这里拆成
// VIP_SIGN_FIELDS / YUNBEI_SIGN_FIELDS 两个导出,不要各自再拷一份 —— 拷贝会漏改一处,
// 然后静默返回 null(已签被读成「未知」)。
//
// 待 T3 校正的假设:第一顺位 `sign` 假定表示「今日已签」,而不是「已开通乐签」这类长期状态;
// 若是后者,跨天会误报成功。真机若只给 `signDayTime` 一类日期戳,应改成「与今天比对」,
// 不要继续信 `sign` 的布尔。该条已记进报告与 NOTICE 的 T3 待校正清单。
export const SIGN_FIELDS = Object.freeze(['sign', 'signed', 'signedToday', 'todaySigned', 'hasSigned'])
