#!/usr/bin/env bash
# 微软积分:宿主侧一次运行 —— 守卫 → 通知 → 容器内跑一遍 → 归类 → 通知
#
# 由 run-all.sh 顺序调用(先微软积分、跑完再微信读书),也可手动执行。
# 与 Windows 版 scripts/windows/run-daily.bat 一一对应,去掉的只有"关机避让"
# (云主机 7x24 在线,没有 02:00 关机这回事),换掉的只有单实例锁(Windows 用
# 进程实况判残锁,Linux 用 flock,进程一死锁自动释放,不存在残锁)。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
ROOT="$SUITE_DIR/rewards"
set -a; [ -f "$SUITE_DIR/suite.env" ] && . "$SUITE_DIR/suite.env"; set +a   # set -a:让参数也进入子进程(node 读的是环境变量)
cd "$ROOT" || exit 1

LOG="$ROOT/logs/last-run.log"
RLOG="$ROOT/logs/runner.log"
STATE="$ROOT/logs/last-run.state"
LOCK="$ROOT/logs/run.lock"
NOTIFIED="$ROOT/logs/skip.notified"   # 只给"需要你处理"用;正常跳过不再推送
WATCHDOG_MIN="${REWARDS_RUN_TIMEOUT_MIN:-150}"
mkdir -p "$ROOT/logs" "$ROOT/config" "$ROOT/sessions" "$SUITE_DIR/state"

REALDAY="$(date +%F)"
CLOCK="$(date +%H:%M:%S)"
# 逻辑日以本地 04:00 为界:凌晨的运行归前一天,否则它会把新的一天标成已完成
if [ "$(date +%H)" -lt 4 ]; then TODAY="$(date -d 'yesterday' +%F)"; else TODAY="$REALDAY"; fi

note() { echo "[$REALDAY $CLOCK] $*" >> "$RLOG"; }
flog() { echo "[$REALDAY $CLOCK] $*" >> "$LOG"; }

# ---- 单实例锁 ----
exec 8>"$SUITE_DIR/state/rewards.flock"
if ! flock -n 8; then
    flog "another run is still in progress, skipped"
    exit 0
fi
# 同伴(微信读书)看的锁文件
printf '{"pid":%d,"startedAt":"%s"}\n' "$$" "$(date -Is)" > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

# ---- 守卫 1:当天已完成 / 尝试次数用尽 ----
RUNS=0
if [ -f "$STATE" ]; then
    read -r STATE_DAY STATE_N < "$STATE" 2>/dev/null || true
    [ "${STATE_DAY:-}" = "$TODAY" ] && RUNS="${STATE_N:-0}"
fi
if [ "$RUNS" -ge 3 ]; then
    KIND=exhausted
    [ "$RUNS" -ge 9 ] && KIND=handled
    note "day $TODAY closed, kind=$KIND, attempts=$RUNS, skipped"
    # 正常跳过不推送(2026-10-04 用户要求),只写 runner.log
    exit 0
fi

# ---- 守卫 2:凭据 ----
if [ ! -f "$ROOT/.env" ] || grep -qE '^ACCOUNT_[0-9]+_EMAIL=(email@example\.com|email_[0-9])' "$ROOT/.env"; then
    flog ".env has no real account configured yet, run skipped"
    if ! grep -q "$TODAY nocreds" "$NOTIFIED" 2>/dev/null; then
        echo "$TODAY nocreds" >> "$NOTIFIED"
        node "$ROOT/wechat-bridge/notify-skip.js" nocreds >> "$RLOG" 2>&1
    fi
    exit 0
fi

# ---- 守卫 3:内存闸门(不消耗当天尝试次数,把机会留给下一次触发) ----
DECISION="$(node "$ROOT/deploy/run-config.js" decide)"
if [ "$DECISION" = "SKIP" ]; then
    FREE_MB="$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)"
    note "free memory ${FREE_MB}MB is below the gate, run skipped (attempt not consumed)"
    # 正常跳过不推送(2026-10-04 用户要求),只写 runner.log
    exit 0
fi

# ---- 轮转日志、记账、开始通知 ----
touch "$LOG"   # 先由宿主创建:容器以 root 追加写入,文件归属保持 ubuntu
[ -f "$LOG" ] && mv -f "$LOG" "$ROOT/logs/previous-run.log"
RUNS=$((RUNS + 1))

# ---- 内存自适应:先定并行度,再发开始通知(通知里会写“并行 N”) ----
CLUSTERS="$(node "$ROOT/deploy/run-config.js" clusters auto)"
FREE_MB="$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)"
node "$ROOT/wechat-bridge/notify-start.js" --day "$TODAY" >> "$LOG" 2>&1
printf '%s %s\n' "$TODAY" "$RUNS" > "$STATE"
note "run start, attempt $RUNS of max 3 today, clusters=$CLUSTERS, free ${FREE_MB}MB"
flog "=== run start, attempt $RUNS of max 3 today ==="
flog "free memory ${FREE_MB}MB -> clusters=$CLUSTERS"

# ---- 跑一次(容器内),带看门狗 ----
COMPOSE="$SUITE_DIR/compose.yaml"
docker compose -f "$COMPOSE" run --rm -T rewards-run >> "$LOG" 2>&1 &
RUNPID=$!
(
    exec 8>&-          # 别继承锁 fd:脚本退出后这个 sleep 还在,会一直占着锁
    sleep $((WATCHDOG_MIN * 60))
    if kill -0 "$RUNPID" 2>/dev/null; then
        echo "[WATCHDOG] run killed after $WATCHDOG_MIN minutes" >> "$LOG"
        # 注意:compose run 的一次性容器名是自动生成的(automation-<svc>-run-<hash>),
        # 不能按 "docker rm -f rewards-run" 删 —— 按 compose 的 service 标签删才命中。
        docker ps -aq --filter "label=com.docker.compose.service=rewards-run" | xargs -r docker rm -f >/dev/null 2>&1
        kill "$RUNPID" 2>/dev/null
    fi
) &
WDPID=$!
wait "$RUNPID"; CODE=$?
kill "$WDPID" 2>/dev/null
wait "$WDPID" 2>/dev/null

# ---- 归类:退出码与日志标记都要看(脚本登录失败也可能退 0) ----
DONE=0; FAIL=0
grep -qF "[ACCOUNT-END]" "$LOG" && DONE=1
grep -qF "[ACCOUNT-SKIP]" "$LOG" && DONE=1
[ "$CODE" -ne 0 ] && FAIL=1
for marker in "flow failed for" "[ACCOUNT-ERROR]" "fatal error:" "[CLUSTER-WORKER-ERROR]" "[WATCHDOG] run killed after"; do
    grep -qF "$marker" "$LOG" && FAIL=1
done
[ "$DONE" -eq 0 ] && FAIL=1

if [ "$FAIL" -eq 0 ]; then
    printf '%s 9\n' "$TODAY" > "$STATE"
    flog "=== run finished OK, exit code $CODE ==="
else
    flog "=== run finished with FAILURES, exit code $CODE ==="
    [ "$CODE" -eq 0 ] && CODE=1
fi

# ---- 结束通知(解析本次日志;通知失败不影响退出码) ----
node "$ROOT/wechat-bridge/notify-run.js" "$LOG" >> "$LOG" 2>&1
exit "$CODE"
