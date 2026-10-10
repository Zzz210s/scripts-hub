#!/usr/bin/env bash
# B站任务:宿主侧一次运行。
#
# 守卫、单实例、通知都由程序自己管(src/guards.js、src/lock.js、src/notify.js),所以宿主只做:
# 轮转日志 → 在容器里跑一次(带看门狗)→ 崩在发消息之前时补一条兜底提醒。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
ROOT="$SUITE_DIR/bilibili"
set -a; [ -f "$SUITE_DIR/suite.env" ] && . "$SUITE_DIR/suite.env"; set +a
cd "$ROOT" || exit 1

LOG="$ROOT/logs/last-run.log"
RLOG="$ROOT/logs/runner.log"
# 薄壳侧 Console 超时默认 20 分钟,宿主看门狗留余量
WATCHDOG_MIN="${BILIBILI_RUN_TIMEOUT_MIN:-30}"
mkdir -p "$ROOT/logs" "$ROOT/data" "$ROOT/secrets" "$SUITE_DIR/state"

REALDAY="$(date +%F)"; CLOCK="$(date +%H:%M:%S)"
note() { echo "[$REALDAY $CLOCK] $*" >> "$RLOG"; }

# 单实例:与容器内程序的锁互为双保险
exec 9>"$SUITE_DIR/state/bilibili.flock"
if ! flock -n 9; then
    echo "[$REALDAY $CLOCK] another run is still in progress, skipped" >> "$LOG"
    exit 0
fi

touch "$LOG"   # 先由宿主创建:容器以 root 追加写入,文件归属保持 ubuntu
[ -f "$LOG" ] && mv -f "$LOG" "$ROOT/logs/previous-run.log"

COMPOSE="$SUITE_DIR/compose.yaml"
docker compose -f "$COMPOSE" run --rm -T bilibili-run >> "$LOG" 2>&1 &
RUNPID=$!
(
    exec 9>&-          # 别继承锁 fd
    sleep $((WATCHDOG_MIN * 60))
    if kill -0 "$RUNPID" 2>/dev/null; then
        echo "[WATCHDOG] run killed after $WATCHDOG_MIN minutes" >> "$LOG"
        # compose run 的一次性容器名是自动生成的,按 service 标签删才命中
        docker ps -aq --filter "label=com.docker.compose.service=bilibili-run" | xargs -r docker rm -f >/dev/null 2>&1
        kill "$RUNPID" 2>/dev/null
    fi
) &
WDPID=$!
wait "$RUNPID"; CODE=$?
kill "$WDPID" 2>/dev/null
wait "$WDPID" 2>/dev/null

note "=== bilibili run finished, exit code $CODE ==="

# 崩在发消息之前 = 企业微信里什么都没有。补一条兜底提醒。
# 判据:退出码非 0,且日志里既没有"企业微信"(程序试过发送)也没有 "[完成]"。
if [ "$CODE" -ne 0 ] && ! grep -q "企业微信" "$LOG" && ! grep -q "\[完成\]" "$LOG"; then
    node "$SUITE_DIR/alert-fail.mjs" "B站任务" "退出码 $CODE" "$LOG" >> "$RLOG" 2>&1
fi
exit "$CODE"
