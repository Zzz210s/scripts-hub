// Task 9 编排:守卫 -> 锁 -> 逐账号签到 -> 读回对账 -> 落状态与历史 -> 通知。
// 「今天到底签全了没有」的唯一权威是第二层对账:只有 reconcile.ok === true 才把当天记为完成;
// ok:false 与 ok:null 都不锁,留给下一次触发(由尝试次数上限封顶)。
// 账号一律以配置里的唯一 id 为键贯穿(凭据体检 / 读回列表 / 逐账号结果),显示名只用于渲染 ——
// 两个同名账号不能让链路串号。网络、时间、发送、内存、同伴、锁全部从 deps 注入,可离线集成测试。
import { dateText, logicalDay } from './clock.js';
import { loadConfig } from './config.js';
import { checkLocalGuards, checkOnlineGuards } from './guards.js';
import { acquireLock, releaseLock } from './lock.js';
import { buildResult, buildSkip, buildStart } from './messages.js';
import {
  labelMap,
  lastDelivery,
  makeDeliver,
  peerOf,
  probeCredentials,
  relabelReconcile,
  routeSkip,
  signAll,
  trimAccounts,
  view,
  warnFailedDeliveries,
} from './run-support.js';
import { appendHistory, attemptsOn, doneToday, markDayDone, readState, recordAttempts, writeState } from './state.js';
import { reconcile } from './verify.js';

export async function runOnce({ cwd = process.cwd(), now = new Date(), dryRun = false, deps = {} } = {}) {
  const log = deps.log ?? (() => {});
  const config = deps.config ?? loadConfig(cwd, { env: deps.env, fsImpl: deps.fsImpl });
  const dry = dryRun === true || config.dryRun === true;
  const date = dateText(now);
  const day = logicalDay(now, config.boundaryHour);
  const accounts = Array.isArray(config.accounts) ? config.accounts : [];
  const labels = labelMap(accounts);
  const { state, warnings } = readState(config.stateDir, { fsImpl: deps.fsImpl });
  for (const warning of warnings) log(`[警告] ${warning}`);

  const messages = [];
  const deliveries = [];
  const deliver = makeDeliver(deps, { messages, deliveries });

  const skip = async (reason, detail = '', accountsForMessage = view(accounts)) => {
    const routed = routeSkip({ reason, date, accounts: accountsForMessage });
    if (routed.silent) {
      log(buildSkip({ date, accounts: accountsForMessage, reason }));
    } else {
      log(`[跳过] ${reason}${detail ? ` · ${detail}` : ''}`);
      // --dry 时把将要推送的内容打印出来,但不发送。
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
      deliveries,
    };
  };

  // 1. 本地守卫:不联网、秒级返回。dry 也走这一段,因为它决定会推送什么。
  const peer = peerOf(deps, config, now);
  const local = checkLocalGuards({
    now,
    paused: state.paused === true,
    doneToday: doneToday(state, day),
    attempts: attemptsOn(state, day),
    maxAttempts: config.maxAttempts,
    peerRunning: peer.busy === true,
    peerDetail: peer.detail ?? '',
    freeMb: deps.freeMb ? deps.freeMb() : Infinity,
    limits: {
      quietStart: config.quietStart,
      quietEnd: config.quietEnd,
      shutdownTime: config.shutdownTime,
      shutdownMarginMinutes: config.shutdownMarginMinutes,
      minFreeMb: config.minFreeMb,
    },
  });
  if (local.action === 'skip') return skip(local.reason, local.detail);

  // 2. dry:只规划与预览 —— 不加锁、不联网、不发送、不写状态、不消耗当天尝试次数。
  if (dry) {
    const planned = [
      buildStart({ date, accounts: view(accounts) }),
      buildResult({ date, accounts: view(accounts), reconcile: null, exitCode: 0, dryRun: true }),
    ];
    for (const text of planned) log(text);
    return {
      skipped: false,
      ok: false,
      dryRun: true,
      perAccount: [],
      reconcile: null,
      exitCode: 0,
      reason: 'dry-run',
      messages: planned,
      deliveries: [],
    };
  }

  // 3. 单实例锁(宿主 run.sh 另有 flock,两层互补)。
  const acquire = deps.acquireLock ?? acquireLock;
  const lock = acquire(config.lockDir, { now });
  if (!lock.ok) return skip('peer-running', '已有一次运行在跑');

  try {
    // 4. 在线守卫:逐账号试取 tbs,键用唯一 id。单账号失效不拦整轮。
    const credentials = await probeCredentials(accounts, deps);
    const online = checkOnlineGuards({ credentials });
    // 全失效时把逐账号错误细节一并交给渲染,而不是只报一个名字。
    if (online.action === 'skip') return await skip(online.reason, online.detail, view(credentials));

    // 5. 开跑前先记一次尝试并落盘:进程被 kill、发送抛错都不至于让这次定时触发白来
    //    (否则 attempts-exhausted 永不触发、每个触发都从头再来且不通知)。结论稍后补。
    recordAttempts(state, { day, ok: false, now });
    writeState(state, config.stateDir, now, { fsImpl: deps.fsImpl });
    await deliver(buildStart({ date, accounts: view(accounts) }));

    // 6. 逐账号串行签到,签完立刻读回该账号的关注列表。凭据失效的账号直接记账,不重试。
    const { outcomes, forumsAfter } = await signAll({ accounts, credentials, config, deps });

    // 7. 第二层对账。expected 必须与 signAccount 收到的是同一个 filter,否则白名单形态口径不一致。
    const reconcileResult = relabelReconcile(
      reconcile({
        forumsAfter,
        resultsByAccount: Object.fromEntries(outcomes.map((outcome) => [outcome.id, outcome.results])),
        expected: config.filter,
      }),
      labels,
    );
    const ok = reconcileResult.ok === true;
    const exitCode = ok ? 0 : 1;
    await deliver(buildResult({ date, accounts: outcomes, reconcile: reconcileResult, exitCode, dryRun: false }));

    // 8. 落状态与历史:失败尝试已在开跑前记下,这里只在对账通过时补「已完成」。
    if (ok) markDayDone(state, { day, now });
    writeState(state, config.stateDir, now, { fsImpl: deps.fsImpl });
    appendHistory(
      {
        day,
        date,
        ok,
        reason: reconcileResult.reason,
        missingTotal: reconcileResult.missingTotal,
        exitCode,
        accounts: trimAccounts(outcomes),
        reconcile: reconcileResult,
      },
      config.stateDir,
      { now, fsImpl: deps.fsImpl },
    );
    log(`[完成] ${ok ? '运行成功' : '运行有失败'}`);
    warnFailedDeliveries(log, deliveries);
    return {
      skipped: false,
      ok,
      dryRun: false,
      perAccount: reconcileResult.perAccount,
      reconcile: reconcileResult,
      exitCode,
      reason: reconcileResult.reason,
      messages,
      deliveries,
      lastDelivery: lastDelivery(deliveries),
    };
  } finally {
    const release = deps.releaseLock ?? releaseLock;
    try {
      release(config.lockDir);
    } catch {
      /* 解锁失败不覆盖真实结论 */
    }
  }
}
