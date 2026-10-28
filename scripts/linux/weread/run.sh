#!/usr/bin/env bash
# 微信读书签到:宿主侧一次运行。一次可能跑 1-2 小时,看门狗默认 120 分钟。
#
# 骨架(轮转日志 / flock / 容器内跑一次 / 看门狗 / 兜底提醒)在套件根目录的 run-lib.sh,
# 六个程序共用一份 —— 修一处不再要改六处(2026-10-29 合并)。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
PROG_TITLE="微信读书签到"
PROG_DIR="$SUITE_DIR/weread"
PROG_SERVICE="weread-run"
PROG_TIMEOUT_MIN="${WEREAD_RUN_TIMEOUT_MIN:-120}"

# shellcheck source=/dev/null   # 部署后在 $SUITE_DIR 下;静态检查时不存在
. "$SUITE_DIR/run-lib.sh"

# 不带参数 = 跑一次任务;`run.sh check` 这类只读子命令会透传进容器
run_program "$@"
