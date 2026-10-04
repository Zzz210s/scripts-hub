#!/usr/bin/env bash
# 微信读书签到:宿主侧一次运行。
#
# 与微软积分不同,这个程序自己带齐了守卫(本地段 + 联网段)、单实例锁、看门狗之外的
# 超时控制与企业微信通知(src/guards.js、src/peer.js、src/notify*.js),所以宿主只做三件事:
# 轮转日志 → 在容器里跑一次 → 记录退出码。守卫参数全在 weread/.env 里。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
ROOT="$SUITE_DIR/weread"
[ -f "$SUITE_DIR/suite.env" ] && . "$SUITE_DIR/suite.env"
cd "$ROOT" || exit 1

LOG="$ROOT/logs/last-run.log"
RLOG="$ROOT/logs/runner.log"
WATCHDOG_MIN="${WEREAD_RUN_TIMEOUT_MIN:-100}"
mkdir -p "$ROOT/logs" "$ROOT/data" "$SUITE_DIR/state"

REALDAY="$(date +%F)"; CLOCK="$(date +%H:%M:%S)"
note() { echo "[$REALDAY $CLOCK] $*" >> "$RLOG"; }

# 单实例:与容器内的锁互为双保险(容器内的锁挡住容器内重复启动,这里挡住并发编排)
exec 9>"$SUITE_DIR/state/weread.flock"
if ! flock -n 9; then
    echo "[$REALDAY $CLOCK] another run is still in progress, skipped" >> "$LOG"
    exit 0
fi

touch "$LOG"   # 先由宿主创建:容器以 root 追加写入,文件归属保持 ubuntu
[ -f "$LOG" ] && mv -f "$LOG" "$ROOT/logs/previous-run.log"

COMPOSE="$SUITE_DIR/compose.yaml"
docker compose -f "$COMPOSE" run --rm -T weread-run >> "$LOG" 2>&1 &
RUNPID=$!
(
    exec 9>&-          # 别继承锁 fd:脚本退出后这个 sleep 还在,会一直占着锁
    sleep $((WATCHDOG_MIN * 60))
    if kill -0 "$RUNPID" 2>/dev/null; then
        echo "[WATCHDOG] run killed after $WATCHDOG_MIN minutes" >> "$LOG"
        docker rm -f weread-run >/dev/null 2>&1
        kill "$RUNPID" 2>/dev/null
    fi
) &
WDPID=$!
wait "$RUNPID"; CODE=$?
kill "$WDPID" 2>/dev/null
wait "$WDPID" 2>/dev/null

note "=== weread run finished, exit code $CODE ==="
exit "$CODE"
