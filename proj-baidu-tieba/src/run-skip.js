// 跳过路径:守卫命中时统一从这里走 —— 该静默的静默、该推送的推送、--dry 只打印不发送。
//
// 单独成文件的原因:它横跨路由判定、文案渲染与投递三件事,留在 run.js 主干里会把
// 「守卫 → 签到 → 对账 → 互动」这条主线挤散,也会让自研文件超过 200 行。

import { buildSkip } from './messages.js';
import { routeSkip, view, warnFailedDeliveries } from './run-support.js';

/**
 * 造一个 skip():传什么原因码都行,返回的正是编排层要的那份结果对象。
 * `dry` 为真时只把将推送的文本打进日志。
 */
export function makeSkipper({ date, accounts, log, dry, deliver, deliveries }) {
  return async function skip(reason, detail = '', accountsForMessage = view(accounts)) {
    const routed = routeSkip({ reason, date, accounts: accountsForMessage });
    if (routed.silent) {
      log(buildSkip({ date, accounts: accountsForMessage, reason }));
    } else {
      log(`[跳过] ${reason}${detail ? ` · ${detail}` : ''}`);
      for (const text of routed.messages) {
        if (dry) log(text);
        else await deliver(text);
      }
    }
    warnFailedDeliveries(log, deliveries);
    return {
      skipped: true,
      ok: false,
      dryRun: dry,
      perAccount: [],
      reconcile: null,
      exitCode: 0,
      reason,
      detail,
      messages: routed.messages,
      deliveries
    };
  };
}
