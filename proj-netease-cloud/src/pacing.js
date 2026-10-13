// 同账号请求间隔的硬约束:设计文档第 5 节要求 >=3 秒(单账号串行、每日一次)。
// 逻辑与平台无关;sleep 可注入,离线测试不会真的等 3 秒。
export const MIN_INTERVAL_MS = 3000

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 等一次请求间隔。间隔取 max(3000, deps.intervalMs) —— 配置只能把它调大,不能调小。
 * 返回实际等待的毫秒数,便于调用方/测试记录。
 */
export async function pace(deps) {
  const wanted = Number(deps?.intervalMs)
  const interval = Number.isFinite(wanted) && wanted > MIN_INTERVAL_MS ? wanted : MIN_INTERVAL_MS
  await (deps?.sleep ?? defaultSleep)(interval)
  return interval
}
