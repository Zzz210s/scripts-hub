#!/usr/bin/env bash
# 百度贴吧签到:宿主侧一次运行。
#
# 守卫、单实例、通知都由程序自己管(src/guards.js、src/lock.js、src/notify.js),所以宿主只做:
# 轮转日志 → 在容器里跑一次(带看门狗)→ 崩在发消息之前时补一条兜底提醒。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
ROOT="$SUITE_DIR/tieba"
set -a
# shellcheck source=/dev/null   # suite.env 在宿主机上,静态检查时不存在
[ -f "$SUITE_DIR/suite.env" ] && . "$SUITE_DIR/suite.env"
set +a
cd "$ROOT" || exit 1

LOG="$ROOT/logs/last-run.log"
RLOG="$ROOT/logs/runner.log"
# 纯 HTTP、账号串行,一次几分钟就结束;看门狗只防接口卡死
WATCHDOG_MIN="${TIEBA_RUN_TIMEOUT_MIN:-20}"
mkdir -p "$ROOT/logs" "$ROOT/data" "$ROOT/secrets" "$SUITE_DIR/state"

REALDAY="$(date +%F)"; CLOCK="$(date +%H:%M:%S)"
note() { echo "[$REALDAY $CLOCK] $*" >> "$RLOG"; }

# 单实例:与容器内程序的锁互为双保险。容器内那把在跨容器场景不提供互斥(每次运行都是
# 新容器,hostname 与 pid 命名空间都不同),宿主这把 flock 才是真正的保证。
exec 9>"$SUITE_DIR/state/tieba.flock"
if ! flock -n 9; then
    echo "[$REALDAY $CLOCK] another run is still in progress, skipped" >> "$LOG"
    exit 0
fi

touch "$LOG"   # 先由宿主创建:容器以 root 追加写入,文件归属保持 ubuntu
[ -f "$LOG" ] && mv -f "$LOG" "$ROOT/logs/previous-run.log"

COMPOSE="$SUITE_DIR/compose.yaml"
docker compose -f "$COMPOSE" run --rm -T tieba-run >> "$LOG" 2>&1 &
RUNPID=$!
(
    exec 9>&-          # 别继承锁 fd:脚本退出后这个 sleep 还在,会一直占着锁
    sleep $((WATCHDOG_MIN * 60))
    if kill -0 "$RUNPID" 2>/dev/null; then
        echo "[WATCHDOG] run killed after $WATCHDOG_MIN minutes" >> "$LOG"
        # compose run 的一次性容器名是自动生成的,按 service 标签删才命中
        docker ps -aq --filter "label=com.docker.compose.service=tieba-run" | xargs -r docker rm -f >/dev/null 2>&1
        kill "$RUNPID" 2>/dev/null
    fi
) &
WDPID=$!
wait "$RUNPID"; CODE=$?
kill "$WDPID" 2>/dev/null
wait "$WDPID" 2>/dev/null

note "=== tieba run finished, exit code $CODE ==="

# 兜底提醒:守卫跳过一律退出码 0(信号靠 action 消息传出去),所以非 0 只可能是真异常退出,
# 这里不做退出码分级。判据看日志:真跑到底的那次一定写 [完成];没有它说明崩在了发消息之前,
# 企业微信里什么都没有,只能在这里补一条。
if [ "$CODE" -ne 0 ] && ! grep -q "\[完成\]" "$LOG"; then
    node "$SUITE_DIR/alert-fail.mjs" "百度贴吧" "退出码 $CODE" "$LOG" >> "$RLOG" 2>&1
fi
exit "$CODE"
