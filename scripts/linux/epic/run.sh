#!/usr/bin/env bash
# Epic 限免领取:宿主侧一次运行。
#
# 守卫(已暂停 / 次数用尽 / 同伴在跑 / 安静时段 / 内存不足)由程序自己判(src/guards.js),
# 所以宿主只做三件事:单实例锁 → 轮转日志 + 跑一次(带看门狗)→ 崩了补一条兜底提醒。
# 大部分触发是"本期限免已全部领过",程序探测完直接退出,几秒钟就结束。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
ROOT="$SUITE_DIR/epic"
set -a; [ -f "$SUITE_DIR/suite.env" ] && . "$SUITE_DIR/suite.env"; set +a   # set -a:让参数也进入子进程
cd "$ROOT" || exit 1

LOG="$ROOT/logs/last-run.log"
RLOG="$ROOT/logs/runner.log"
# 程序自己的引擎超时是 30 分钟(EPIC_ENGINE_TIMEOUT_MINUTES),宿主看门狗留一点余量
WATCHDOG_MIN="${EPIC_RUN_TIMEOUT_MIN:-40}"
mkdir -p "$ROOT/logs" "$ROOT/data" "$SUITE_DIR/state"

REALDAY="$(date +%F)"; CLOCK="$(date +%H:%M:%S)"
note() { echo "[$REALDAY $CLOCK] $*" >> "$RLOG"; }

# 单实例:与容器内程序的锁互为双保险(容器内那把挡住容器内重复启动,这把挡住并发编排)
exec 9>"$SUITE_DIR/state/epic.flock"
if ! flock -n 9; then
    echo "[$REALDAY $CLOCK] another run is still in progress, skipped" >> "$LOG"
    exit 0
fi

touch "$LOG"   # 先由宿主创建:容器以 root 追加写入,文件归属保持 ubuntu
[ -f "$LOG" ] && mv -f "$LOG" "$ROOT/logs/previous-run.log"

COMPOSE="$SUITE_DIR/compose.yaml"
docker compose -f "$COMPOSE" run --rm -T epic-run >> "$LOG" 2>&1 &
RUNPID=$!
(
    exec 9>&-          # 别继承锁 fd:脚本退出后这个 sleep 还在,会一直占着锁
    sleep $((WATCHDOG_MIN * 60))
    if kill -0 "$RUNPID" 2>/dev/null; then
        echo "[WATCHDOG] run killed after $WATCHDOG_MIN minutes" >> "$LOG"
        # compose run 的一次性容器名是自动生成的,按 service 标签删才命中
        docker ps -aq --filter "label=com.docker.compose.service=epic-run" | xargs -r docker rm -f >/dev/null 2>&1
        kill "$RUNPID" 2>/dev/null
    fi
) &
WDPID=$!
wait "$RUNPID"; CODE=$?
kill "$WDPID" 2>/dev/null
wait "$WDPID" 2>/dev/null

note "=== epic run finished, exit code $CODE ==="

# 崩在发消息之前 = 企业微信里什么都没有。补一条兜底提醒(出现过"企业微信"说明程序至少试过发送)
# 判据:退出码非 0,且日志里既没有"企业微信"(程序试过发送)也没有 "[完成]"
# (程序跑完并自己报过结果)。2026-10-06:Epic 的日志里没有"企业微信"字样,
# 只按那一条判会误报成"运行在发消息前就退出了",同一天连推两条。
if [ "$CODE" -ne 0 ] && ! grep -q "企业微信" "$LOG" && ! grep -q "\[完成\]" "$LOG"; then
    node "$SUITE_DIR/alert-fail.mjs" "Epic 限免" "退出码 $CODE" "$LOG" >> "$RLOG" 2>&1
fi
exit "$CODE"
