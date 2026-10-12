#!/usr/bin/env bash
# 自动化套件顺序编排:先微软积分,跑完再微信读书(一项结束才启动下一项)
#
# 由 systemd 的 automation-suite.timer 触发(每天 08:00 与 12:00,Persistent=true —— 机器
# 关机/重启错过的触发在开机后补跑一次)。任一程序失败都不影响另一个:各自有自己的
# 通知与当天重试机会。整套同时只允许一次(flock)。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
set -a
# shellcheck source=/dev/null   # suite.env 在宿主机上,静态检查时不存在
[ -f "$SUITE_DIR/suite.env" ] && . "$SUITE_DIR/suite.env"   # set -a:让参数也进入子进程(node 读的是环境变量)
set +a
LOG="$SUITE_DIR/logs/suite.log"
mkdir -p "$SUITE_DIR/logs" "$SUITE_DIR/state"

note() { echo "[$(date -Is)] $*" >> "$LOG"; }

# --- 闸门:只调 config/schedule.json 里启用的程序 ------------------------------------------
# 真源是仓库的 config/schedule.json(linuxEnabled,缺省回落 enabled)。服务器上按顺序找:
# SUITE_SCHEDULE 显式指定 -> 部署根下的副本 -> 套件机器上的仓库克隆 -> 仓库相对路径。
# 只认闸门退出码:0 启用 · 1 明确关闭 · >=2 读不到(文件不存在、坏 JSON、取值非布尔)。
# 配置读不到时 **fail-closed**:退回下面这份固定四程序清单,百度贴吧不跑,并记一条告警 ——
# 一次坏 JSON 既不能让五个程序被静默跳过,也不能把还没真机验证的贴吧带跑。
FALLBACK_PROGRAMS="microsoft-rewards weread-signin epic-free-games bilibili-tasks"
SCHEDULE=""
[ -n "${SUITE_SCHEDULE:-}" ] && [ -f "$SUITE_SCHEDULE" ] && SCHEDULE="$SUITE_SCHEDULE"
for candidate in "$SUITE_DIR/schedule.json" "$SUITE_DIR/config/schedule.json" \
                 "$HOME/scripts-hub/config/schedule.json" "$(dirname "$0")/../../config/schedule.json"; do
    [ -n "$SCHEDULE" ] && break
    [ -f "$candidate" ] && SCHEDULE="$candidate"
done
GATE="$SUITE_DIR/program-enabled.mjs"
GATE_MODE="fallback"   # ok = 按 schedule.json;fallback = 按固定四程序清单
enabled_in_schedule() {
    local id="$1" rc=1
    if [ "$GATE_MODE" = "ok" ]; then
        node "$GATE" is-enabled "$SCHEDULE" "$id"
        rc=$?
        [ "$rc" -le 1 ] && return "$rc"
        note "[警告] $id 闸门退出码 $rc,判定不可信,降级为固定清单"
        GATE_MODE="fallback"
    fi
    case " $FALLBACK_PROGRAMS " in
        *" $id "*) return 0 ;;
        *) return 1 ;;
    esac
}

exec 7>"$SUITE_DIR/state/suite.flock"
if ! flock -n 7; then
    note "已有一次编排在跑,本次触发跳过"
    exit 0
fi

if [ -n "$SCHEDULE" ] && [ -f "$SCHEDULE" ] && [ -f "$GATE" ]; then
    if GATE_ERROR=$(node "$GATE" list "$SCHEDULE" 2>&1 >/dev/null); then
        GATE_MODE="ok"
    fi
else
    GATE_ERROR="找不到 schedule.json 或 program-enabled.mjs"
fi

if [ "$GATE_MODE" = "ok" ]; then
    note "=== 编排开始(schedule.json=$SCHEDULE;按 order 串行)==="
else
    note "[警告] 调度闸门不可用,退回固定四程序清单,百度贴吧不跑:$GATE_ERROR"
    note "=== 编排开始(闸门失效:微软积分、微信读书、Epic 限免、B站任务照跑;百度贴吧不跑)==="
fi

if enabled_in_schedule microsoft-rewards; then
    "$SUITE_DIR/rewards/run.sh" 7>&-
    RC_REWARDS=$?
    note "微软积分退出码 $RC_REWARDS"
else
    RC_REWARDS=0
    note "微软积分已关闭(schedule.json),跳过"
fi

if enabled_in_schedule weread-signin; then
    "$SUITE_DIR/weread/run.sh" 7>&-
    RC_WEREAD=$?
    note "微信读书退出码 $RC_WEREAD"
else
    RC_WEREAD=0
    note "微信读书已关闭(schedule.json),跳过"
fi

if enabled_in_schedule epic-free-games; then
    "$SUITE_DIR/epic/run.sh" 7>&-
    RC_EPIC=$?
    note "Epic 限免退出码 $RC_EPIC"
else
    RC_EPIC=0
    note "Epic 限免已关闭(schedule.json),跳过"
fi

if enabled_in_schedule bilibili-tasks; then
    "$SUITE_DIR/bilibili/run.sh" 7>&-
    RC_BILIBILI=$?
    note "B站任务退出码 $RC_BILIBILI"
else
    RC_BILIBILI=0
    note "B站任务已关闭(schedule.json),跳过"
fi

if enabled_in_schedule baidu-tieba; then
    "$SUITE_DIR/tieba/run.sh" 7>&-
    RC_TIEBA=$?
    note "百度贴吧退出码 $RC_TIEBA"
else
    RC_TIEBA=0
    if [ "$GATE_MODE" = "ok" ]; then
        note "百度贴吧已关闭(schedule.json),跳过"
    else
        note "百度贴吧不在固定四程序清单里,跳过"
    fi
fi

note "=== 编排结束 ==="
if [ "$RC_REWARDS" -eq 0 ] && [ "$RC_WEREAD" -eq 0 ] && [ "$RC_EPIC" -eq 0 ] && [ "$RC_BILIBILI" -eq 0 ] && [ "$RC_TIEBA" -eq 0 ]; then
    exit 0
fi
exit 1
