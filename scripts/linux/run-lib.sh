#!/usr/bin/env bash
# 宿主侧运行器的共用骨架:轮转日志 → flock 单实例 → 容器里跑一次(带看门狗)→ 兜底提醒。
#
# 为什么单独成文件:六个程序的 run.sh 里这段原本各抄一遍(每份约 60 行,只有名字不同),
# 于是修一个坑要改六处 —— 例如 2026-10-28「docker compose run 等 stdin 把调用方挂住」那次,
# 六份都得手工补 `</dev/null`;还有一次看门狗杀不干净 `sleep`,留下 PPID=1 的孤儿进程。
# 现在只改这里。
#
# 用法(在各程序的 run.sh 里):
#   SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
#   PROG_TITLE="百度贴吧"          # 兜底提醒里显示的名字
#   PROG_DIR="$SUITE_DIR/tieba"    # 该程序在宿主上的目录
#   PROG_SERVICE="tieba-run"       # compose.yaml 里的服务名
#   PROG_TIMEOUT_MIN="${TIEBA_RUN_TIMEOUT_MIN:-20}"
#   . "$SUITE_DIR/run-lib.sh"      # 部署后本文件就在套件根目录
#   run_program                    # 一次性做完:轮转、加锁、跑、提醒、退出码
#
# 需要在自己的步骤之间插入逻辑时,可分开调用:
#   rp_prepare、rp_run_container(结果在 $CODE)、rp_report
set -uo pipefail

# 共用工具:带时间戳写 runner.log
rp_note() { echo "[$(date +%F) $(date +%H:%M:%S)] $*" >> "$RLOG"; }

# 准备:目录、日志轮转、flock。RP_LOCK_FD 默认 9(rewards 用 8)。
rp_prepare() {
    : "${PROG_DIR:?需要 PROG_DIR}" "${PROG_SERVICE:?需要 PROG_SERVICE}"
    LOG="$PROG_DIR/logs/last-run.log"
    RLOG="$PROG_DIR/logs/runner.log"
    mkdir -p "$PROG_DIR/logs" "$PROG_DIR/data" "$PROG_DIR/secrets" "$SUITE_DIR/state"

    # 单实例:与容器内程序的锁互为双保险。容器内那把在跨容器场景不提供互斥(每次运行都是
    # 新容器,hostname 与 pid 命名空间都不同),宿主这把 flock 才是真正的保证。
    exec 9>"$SUITE_DIR/state/${PROG_DIR##*/}.flock"
    if ! flock -n 9; then
        echo "[$(date +%F) $(date +%H:%M:%S)] another run is still in progress, skipped" >> "$LOG"
        return 1
    fi

    touch "$LOG"   # 先由宿主创建:容器以 root 追加写入,文件归属保持 ubuntu
    [ -f "$LOG" ] && mv -f "$LOG" "$PROG_DIR/logs/previous-run.log"
    return 0
}

# 在容器里跑一次,带看门狗。返回容器退出码,写进 CODE。
# 两个细节都是踩过的坑:`</dev/null` 让一次性容器不去等 stdin;看门狗先杀 sleep 再杀子 shell,
# 否则会留下 PPID=1 的孤儿;锁 fd 不能被子进程继承,否则脚本退出后 sleep 还占着锁。
rp_run_container() {
    local compose="$SUITE_DIR/compose.yaml"
    local minutes="${PROG_TIMEOUT_MIN:-20}"
    # 子命令透传:run.sh check / report 这类只读入口照旧可用(不带参数 = 跑一次任务)
    # 注意 `9>&-` 必须写成**不带引号的字面量**:加引号后 bash 会把它当成一个普通参数传下去,
    # 容器里就变成 `node src/cli.js 9>&-` → 打印用法并以 2 退出(2026-10-29 六程序全挂的根因)。
    docker compose -f "$compose" run --rm -T "$PROG_SERVICE" "$@" </dev/null >> "$LOG" 2>&1 9>&- &
    local runpid=$!
    (
        exec 9>&-
        exec </dev/null >/dev/null 2>&1
        sleep $((minutes * 60))
        if kill -0 "$runpid" 2>/dev/null; then
            echo "[WATCHDOG] run killed after $minutes minutes" >> "$LOG"
            # compose run 的一次性容器名是自动生成的,按 service 标签删才命中
            docker ps -aq --filter "label=com.docker.compose.service=$PROG_SERVICE" \
                | xargs -r docker rm -f >/dev/null 2>&1
            kill "$runpid" 2>/dev/null
        fi
    ) &
    local wdpid=$!
    wait "$runpid"; CODE=$?
    pkill -P "$wdpid" 2>/dev/null
    kill "$wdpid" 2>/dev/null
    wait "$wdpid" 2>/dev/null
    rp_note "=== ${PROG_SERVICE} run finished, exit code $CODE ==="
    return "$CODE"
}

# 兜底提醒:退出码非 0 且日志里没有 [完成],说明它崩在了发消息之前 —— 企业微信里什么都不会有。
# 守卫跳过一律退出码 0(信号靠 action 消息),所以这里不做退出码分级。
rp_report() {
    local code="${1:-$CODE}"
    if [ "$code" -ne 0 ] && ! grep -q "\[完成\]" "$LOG"; then
        node "$SUITE_DIR/alert-fail.mjs" "$PROG_TITLE" "退出码 $code" "$LOG" >> "$RLOG" 2>&1
    fi
    return "$code"
}

# 一次性做完:准备 → 跑 → 提醒。加锁失败(已有一次在跑)按 0 退出,不算失败。
run_program() {
    rp_prepare || exit 0
    rp_run_container "$@"
    rp_report "$CODE"
    exit $?
}
