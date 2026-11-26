#!/usr/bin/env bash
# 淘宝闪购吃货豆:宿主侧一次运行。守卫、锁、通知都在程序里,宿主只做轮转→跑一次→兜底提醒。
#
# 骨架(轮转日志 / flock / 容器内跑一次 / 看门狗 / 兜底提醒)在套件根目录的 run-lib.sh,
# 与贴吧、网易云等程序共用一份 —— 修一处不必改七处。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
set -a; [ -f "$SUITE_DIR/suite.env" ] && . "$SUITE_DIR/suite.env"; set +a
PROG_TITLE="淘宝闪购吃货豆"
PROG_DIR="$SUITE_DIR/shanggou"
PROG_SERVICE="shanggou-run"
# 一次运行 = 起 Chromium + 等页面 + 点几下;给 25 分钟够慢网络与重试。
PROG_TIMEOUT_MIN="${SHANGGOU_RUN_TIMEOUT_MIN:-25}"

# shellcheck source=/dev/null
. "$SUITE_DIR/run-lib.sh"

run_program "$@"
