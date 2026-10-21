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
# 配置读不到时 **fail-closed**:退回下面这份固定四程序清单,百度贴吧与网易云不跑,并记一条告警 ——
# 一次坏 JSON 既不能让程序被静默跳过,也不能把还没真机验证的两个带跑。
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

# --- 启动前体检:宿主入口缺失或丢了可执行位时,跳过它并说明原因 --------------------------
# 2026-10-21 的真实事故:贴吧与网易云部署时漏铺 <程序>/run.sh,run-all.sh 每次调用都是
# 退出码 127,suite.log 里只有一行「退出码 127」,看起来像程序自身故障。这里先跑布局体检,
# 把「宿主入口不可用」和「程序自己跑失败」区分开。
BROKEN=""
export SUITE_DIR   # check-layout.sh 读它定位套件根目录
if [ -x "$SUITE_DIR/check-layout.sh" ]; then
    BROKEN="$("$SUITE_DIR/check-layout.sh" 2>&1 \
        | grep -E '^  FAIL ' \
        | grep -oE '(rewards|weread|epic|bilibili|tieba|netease): (缺 run\.sh|run\.sh 不可执行|run\.sh 的 docker)' \
        | cut -d: -f1 | sort -u | tr '\n' ' ')"
fi
broken() { case " $BROKEN " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
for b in $BROKEN; do
    note "[警告] $b 的宿主入口不可用(布局体检查出),本次跳过它"
done

# 跳过时的措辞要分清三种原因:入口坏了 / 配置里关了 / 闸门失效时不在固定清单里
skip_note() {   # $1=显示名 $2=目录名
    if broken "$2"; then note "$1 跳过:宿主入口不可用"
    elif [ "$GATE_MODE" = "ok" ]; then note "$1 已关闭(schedule.json),跳过"
    else note "$1 不在固定四程序清单里,跳过"
    fi
}

# --- 中断兜底:编排半路被打断(内存耗尽、被 kill、某步自身报错)时补一条提醒 -------------
# 用 EXIT trap 而不是只包某一步:任何位置退出都会经过它,并且能说清停在第几步。
STEP="准备"
COMPLETED=0
ALERTED=0
on_exit() {
    local code="${1:-0}"   # 由 trap 显式传进来:$? 在函数体里会被前一条命令覆盖(实测得到的是 0)
    [ "$ALERTED" -eq 1 ] && return "$code"   # 信号与 EXIT 两个 trap 会先后触发,只报一次
    ALERTED=1
    if [ "$COMPLETED" -ne 1 ]; then
        note "[异常] 编排在第 ${STEP} 步中断,退出码 $code"
        node "$SUITE_DIR/alert-fail.mjs" 服务器 "编排中断:第 ${STEP} 步,退出码 $code" \
            >> "$SUITE_DIR/logs/suite-alert.log" 2>&1 || true
    fi
    return "$code"
}
# 被 kill 时 $? 不进 EXIT trap(实测拿到的是 0),所以信号要单独接:先记真实码再退出
trap 'on_exit 143; exit 143' TERM
trap 'on_exit 130; exit 130' INT
trap 'on_exit 129; exit 129' HUP
trap 'saved=$?; on_exit "$saved"' EXIT

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
    note "[警告] 调度闸门不可用,退回固定四程序清单,百度贴吧与网易云不跑:$GATE_ERROR"
    note "=== 编排开始(闸门失效:微软积分、微信读书、Epic 限免、B站任务照跑;百度贴吧与网易云不跑)==="
fi

if enabled_in_schedule microsoft-rewards && ! broken rewards; then
    STEP="微软积分"
    "$SUITE_DIR/rewards/run.sh" 7>&-
    RC_REWARDS=$?
    note "微软积分退出码 $RC_REWARDS"
else
    RC_REWARDS=0
    skip_note "微软积分" rewards
fi

if enabled_in_schedule weread-signin && ! broken weread; then
    STEP="微信读书"
    "$SUITE_DIR/weread/run.sh" 7>&-
    RC_WEREAD=$?
    note "微信读书退出码 $RC_WEREAD"
else
    RC_WEREAD=0
    skip_note "微信读书" weread
fi

if enabled_in_schedule epic-free-games && ! broken epic; then
    STEP="Epic 限免"
    "$SUITE_DIR/epic/run.sh" 7>&-
    RC_EPIC=$?
    note "Epic 限免退出码 $RC_EPIC"
else
    RC_EPIC=0
    skip_note "Epic 限免" epic
fi

if enabled_in_schedule bilibili-tasks && ! broken bilibili; then
    STEP="B站任务"
    "$SUITE_DIR/bilibili/run.sh" 7>&-
    RC_BILIBILI=$?
    note "B站任务退出码 $RC_BILIBILI"
else
    RC_BILIBILI=0
    skip_note "B站任务" bilibili
fi

if enabled_in_schedule baidu-tieba && ! broken tieba; then
    STEP="百度贴吧"
    "$SUITE_DIR/tieba/run.sh" 7>&-
    RC_TIEBA=$?
    note "百度贴吧退出码 $RC_TIEBA"
else
    RC_TIEBA=0
    skip_note "百度贴吧" tieba
fi

if enabled_in_schedule netease-cloud && ! broken netease; then
    STEP="网易云"
    "$SUITE_DIR/netease/run.sh" 7>&-
    RC_NETEASE=$?
    note "网易云退出码 $RC_NETEASE"
else
    RC_NETEASE=0
    skip_note "网易云" netease
fi

COMPLETED=1
note "=== 编排结束 ==="
if [ -n "$BROKEN" ]; then
    # 跳过是「少跑了一个程序」而不是「跑失败」,不走各程序自己的通道,发到套件那条线上
    node "$SUITE_DIR/alert-fail.mjs" 服务器 "宿主布局不全,本次跳过:$BROKEN" >> "$SUITE_DIR/logs/suite-alert.log" 2>&1 || true
fi
if [ "$RC_REWARDS" -eq 0 ] && [ "$RC_WEREAD" -eq 0 ] && [ "$RC_EPIC" -eq 0 ] && [ "$RC_BILIBILI" -eq 0 ] && [ "$RC_TIEBA" -eq 0 ] && [ "$RC_NETEASE" -eq 0 ]; then
    exit 0
fi
exit 1
