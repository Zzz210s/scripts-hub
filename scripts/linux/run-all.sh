#!/usr/bin/env bash
# 自动化套件顺序编排:先微软积分,跑完再微信读书(一项结束才启动下一项)
#
# 由 systemd 的 automation-suite.timer 触发(每天 08:00 与 12:00,Persistent=true —— 机器
# 关机/重启错过的触发在开机后补跑一次)。任一程序失败都不影响另一个:各自有自己的
# 通知与当天重试机会。整套同时只允许一次(flock)。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
[ -f "$SUITE_DIR/suite.env" ] && . "$SUITE_DIR/suite.env"
LOG="$SUITE_DIR/logs/suite.log"
mkdir -p "$SUITE_DIR/logs" "$SUITE_DIR/state"

note() { echo "[$(date -Is)] $*" >> "$LOG"; }

exec 7>"$SUITE_DIR/state/suite.flock"
if ! flock -n 7; then
    note "已有一次编排在跑,本次触发跳过"
    exit 0
fi

note "=== 编排开始(先微软积分,后微信读书)==="

"$SUITE_DIR/rewards/run.sh" 7>&-
RC_REWARDS=$?
note "微软积分退出码 $RC_REWARDS"

"$SUITE_DIR/weread/run.sh" 7>&-
RC_WEREAD=$?
note "微信读书退出码 $RC_WEREAD"

note "=== 编排结束 ==="
if [ "$RC_REWARDS" -eq 0 ] && [ "$RC_WEREAD" -eq 0 ]; then
    exit 0
fi
exit 1
