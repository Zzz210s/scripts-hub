// Task 9 编排:守卫 -> 锁 -> 逐账号签到 -> 读回对账 -> 落状态与历史 -> 通知。
// 「今天到底签全了没有」的唯一权威是第二层对账:只有 reconcile.ok === true 才把当天记为完成;
// ok:false 与 ok:null 都不锁,留给下一次触发(由尝试次数上限封顶)。
// 网络、时间、发送、内存、同伴、锁全部从 deps 注入,整条链路可离线集成测试。
import { signAccount } from './account.js';
import { fetchFollowedForums, fetchTbs } from './client.js';
import { dateText, logicalDay } from './clock.js';
import { loadConfig } from './config.js';
import { checkLocalGuards, checkOnlineGuards } from './guards.js';
import { acquireLock, releaseLock } from './lock.js';
import { buildResult, buildSkip, buildStart } from './messages.js';
import { failedAccount, failedList, peerOf, routeSkip, trimAccounts, view } from './run-support.js';
import { appendHistory, attemptsOn, doneToday, readState, recordAttempts, writeState } from './state.js';
import { reconcile } from './verify.js';

export async function runOnce({ cwd = process.cwd(), now = new Date(), dryRun = false, deps = {} } = {}) {
  const log = deps.log ?? (() => {});
  const config = deps.config ?? loadConfig(cwd, { env: deps.env, fsImpl: deps.fsImpl });
  const dry = dryRun === true || config.dryRun === true;
  const date = dateText(now);
  const day = logicalDay(now, config.boundaryHour);
  const accounts = Array.isArray(config.accounts) ? config.accounts : [];
  const { state, warnings } = readState(config.stateDir, { fsImpl: deps.fsImpl });
  for (const warning of warnings) log(`[警告] ${warning}`);

  const skip = async (reason, detail = '') => {
    const routed = routeSkip({ reason, date, accounts: view(accounts) });
    if (routed.silent) {
      log(buildSkip({ date, accounts: view(accounts), reason }));
    } else {
      log(`[跳过] ${reason}${detail ? ` · ${detail}` : ''}`);
      // --dry 时把将要推送的内容打印出来,但不发送。
      for (const text of routed.messages) {
        if (dry) log(text);
        else await deps.send?.(text);
      }
    }
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
    };
  }

  // 3. 单实例锁(宿主 run.sh 另有 flock,两层互补)。
  const acquire = deps.acquireLock ?? acquireLock;
  const lock = acquire(config.stateDir, { now });
  if (!lock.ok) return skip('peer-running', '已有一次运行在跑');

  try {
    // 4. 在线守卫:逐账号试取 tbs,映射成凭据体检结论。单账号失效不拦整轮。
    const credentials = [];
    for (const account of accounts) {
      const probe = await fetchTbs({ cookie: account.cookie, deps });
      credentials.push({ name: account.name, ok: probe.ok, error: probe.error, reason: probe.reason });
    }
    const online = checkOnlineGuards({ credentials });
    if (online.action === 'skip') return await skip(online.reason, online.detail);

    const messages = [];
    const send = async (text) => {
      messages.push(text);
      await deps.send?.(text);
    };
    await send(buildStart({ date, accounts: view(accounts) }));

    // 5. 逐账号串行签到,签完立刻读回该账号的关注列表。凭据失效的账号直接记账,不重试。
    const outcomes = [];
    const forumsAfter = {};
    for (const account of accounts) {
      const credential = credentials.find((item) => item.name === account.name);
      if (credential?.ok !== true) {
        outcomes.push(failedAccount(account.name, credential?.error, credential?.reason));
        forumsAfter[account.name] = failedList(credential?.error, credential?.reason);
        continue;
      }
      outcomes.push(
        await signAccount({
          name: account.name,
          cookie: account.cookie,
          filter: config.filter,
          intervalMs: config.intervalMs,
          deps,
        }),
      );
      forumsAfter[account.name] = await fetchFollowedForums({ cookie: account.cookie, deps });
    }

    // 6. 第二层对账。expected 必须与 signAccount 收到的是同一个 filter,否则白名单形态口径不一致。
    const reconcileResult = reconcile({
      forumsAfter,
      resultsByAccount: Object.fromEntries(outcomes.map((outcome) => [outcome.name, outcome.results])),
      expected: config.filter,
    });
    const ok = reconcileResult.ok === true;
    const exitCode = ok ? 0 : 1;
    await send(buildResult({ date, accounts: outcomes, reconcile: reconcileResult, exitCode, dryRun: false }));

    // 7. 落状态与历史:只有 ok:true 才锁当天;ok:false / ok:null 都留给下一次触发。
    recordAttempts(state, { day, ok, now });
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
    return {
      skipped: false,
      ok,
      dryRun: false,
      perAccount: reconcileResult.perAccount,
      reconcile: reconcileResult,
      exitCode,
      reason: reconcileResult.reason,
      messages,
    };
  } finally {
    const release = deps.releaseLock ?? releaseLock;
    try {
      release(config.stateDir);
    } catch {
      /* 解锁失败不覆盖真实结论 */
    }
  }
}
