#!/usr/bin/env bash
# 微信读书签到:宿主侧一次运行。
#
# 与微软积分不同,这个程序自己带齐了守卫(本地段 + 联网段)、单实例锁、看门狗之外的
# 超时控制与企业微信通知(src/guards.js、src/peer.js、src/notify*.js),所以宿主只做三件事:
# 轮转日志 → 在容器里跑一次 → 记录退出码。守卫参数全在 weread/.env 里。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
ROOT="$SUITE_DIR/weread"
set -a; [ -f "$SUITE_DIR/suite.env" ] && . "$SUITE_DIR/suite.env"; set +a   # set -a:让参数也进入子进程(node 读的是环境变量)
cd "$ROOT" || exit 1

LOG="$ROOT/logs/last-run.log"
RLOG="$ROOT/logs/runner.log"
WATCHDOG_MIN="${WEREAD_RUN_TIMEOUT_MIN:-330}"   # 会话循环:要覆盖最多 3 个会话的累计时长
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
        # 注意:compose run 的一次性容器名是自动生成的(automation-<svc>-run-<hash>),
        # 不能按 "docker rm -f weread-run" 删 —— 按 compose 的 service 标签删才命中。
        docker ps -aq --filter "label=com.docker.compose.service=weread-run" | xargs -r docker rm -f >/dev/null 2>&1
        kill "$RUNPID" 2>/dev/null
    fi
) &
WDPID=$!
wait "$RUNPID"; CODE=$?
kill "$WDPID" 2>/dev/null
wait "$WDPID" 2>/dev/null

note "=== weread run finished, exit code $CODE ==="

# 崩在发消息之前 = 企业微信里什么都没有,人只能靠"今天没消息"猜。补一条兜底提醒。
# 判据:退出码非 0,且日志里连"企业微信"都没出现过(出现过说明程序至少试过发送)。
if [ "$CODE" -ne 0 ] && ! grep -q "企业微信" "$LOG"; then
    node "$SUITE_DIR/alert-fail.mjs" "微信读书签到" "退出码 $CODE" "$LOG" >> "$RLOG" 2>&1
fi
exit "$CODE"
