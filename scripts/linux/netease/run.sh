#!/usr/bin/env bash
# 网易云音乐签到:宿主侧一次运行。守卫、锁、通知都在程序里。
#
# 骨架(轮转日志 / flock / 容器内跑一次 / 看门狗 / 兜底提醒)在套件根目录的 run-lib.sh,
# 六个程序共用一份 —— 修一处不再要改六处(2026-10-29 合并)。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
set -a; [ -f "$SUITE_DIR/suite.env" ] && . "$SUITE_DIR/suite.env"; set +a   # 手工跑单个 run.sh 时也要拿到看门狗时长等参数
PROG_TITLE="网易云"
PROG_DIR="$SUITE_DIR/netease"
PROG_SERVICE="netease-run"
PROG_TIMEOUT_MIN="${NETEASE_RUN_TIMEOUT_MIN:-20}"

# shellcheck source=/dev/null   # 部署后在 $SUITE_DIR 下;静态检查时不存在
. "$SUITE_DIR/run-lib.sh"

# 不带参数 = 跑一次任务;`run.sh check` 这类只读子命令会透传进容器
run_program "$@"
