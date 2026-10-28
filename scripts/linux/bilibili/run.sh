#!/usr/bin/env bash
# B站每日任务:宿主侧一次运行。薄壳自己管守卫/锁/通知,宿主侧只跑容器 + 看门狗。
#
# 骨架(轮转日志 / flock / 容器内跑一次 / 看门狗 / 兜底提醒)在套件根目录的 run-lib.sh,
# 六个程序共用一份 —— 修一处不再要改六处(2026-10-29 合并)。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
PROG_TITLE="B站任务"
PROG_DIR="$SUITE_DIR/bilibili"
PROG_SERVICE="bilibili-run"
PROG_TIMEOUT_MIN="${BILIBILI_RUN_TIMEOUT_MIN:-30}"

# shellcheck source=/dev/null   # 部署后在 $SUITE_DIR 下;静态检查时不存在
. "$SUITE_DIR/run-lib.sh"

# 不带参数 = 跑一次任务;`run.sh check` 这类只读子命令会透传进容器
run_program "$@"
