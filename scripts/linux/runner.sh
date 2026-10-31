#!/usr/bin/env bash
# 唯一的启动控制:所有程序容器都从这里起。改这一个文件就够了。
#
#   runner.sh            按下面的表判断该跑谁,跑完就退
#   runner.sh --plan     只看判断结果,不真的启动容器
#   runner.sh <id>       强制跑某一个(调试用,绕过时间与频率判断)
#
# systemd 每 30 分钟调一次(automation-suite.timer)。每一跳它自己决定:
#   1) 有没有「今天该跑但还没跑」的每日任务 → 有就跑一个(串行,一次只跑一个);
#   2) 没有的话,看微信读书的时长缺口 → 没补完就跑一个阅读会话。
# 这样只有一个控制进程、一个定时器,不用再对 schedule.json / run-all.sh / 各自的 run.sh。

set -uo pipefail

# ═══════════════════════════════════════════════════════════════════════════
#  设置区 —— 人改这里。一行一个程序,字段用 | 分隔,顺序就是执行顺序。
#    字段: id | 显示名 | compose 服务 | 类别 | 钟点 | 星期(1-7,空=每天) | 看门狗分钟 | 启用 | 一天几次
#  类别 daily=每日任务(一跳里按表顺序串行跑完,同旧 run-all.sh);reader=补时长,只在 daily 都闲时跑。
#  钟点写 "08:00,12:00,19:00" 表示到点后两小时内补跑;
#  写 "00:00-19:59/30,23:00-23:59/30" 表示这两个区间里每 30 分钟一跳都算触发。
# ═══════════════════════════════════════════════════════════════════════════
PROGRAMS=(
# id        显示名       服务           类别    钟点                          星期  看门狗  启用  次数
  "rewards  |微软积分    |rewards-run   |daily  |08:00,12:00,19:00            |     |150   |1    |3"
  "epic     |Epic 限免   |epic-run      |daily  |08:00,12:00,19:00            |5    |40    |1    |3"
  "bilibili |B站任务     |bilibili-run  |daily  |08:00,12:00,19:00            |     |120   |1    |3"
  "tieba    |百度贴吧    |tieba-run     |daily  |08:00,12:00,19:00            |     |75    |1    |3"
  "netease  |网易云      |netease-run   |daily  |08:00,12:00,19:00            |     |60    |1    |3"
  # 微信读书:时长要一直插空读到缺口补完(daily 都在忙时它让路),20:00-23:00 安静时段不读。
  "weread   |微信读书    |weread-run    |reader |00:00-19:59/30,23:00-23:59/30|     |720   |1    |12"
)

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
STATE_DIR="$SUITE_DIR/state/runner"
LOG="$SUITE_DIR/logs/runner.log"
# 单实例:两个 tick 撞上时只让一个进去
LOCK="$SUITE_DIR/state/runner.lock"

# ═══════════════════════════════════════════════════════════════════════════
#  逻辑区 —— 一般不用动。要加程序只改上面的表。
# ═══════════════════════════════════════════════════════════════════════════

note() { mkdir -p "$(dirname "$LOG")"; echo "[$(date +%F) $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; echo "${s%"${s##*[![:space:]]}"}"; }

# 拆一行表格 → 全局变量 P_ID/P_NAME/P_SERVICE/P_TIMES/P_DAYS/P_MIN/P_ON/P_MAX
parse_row() {
    IFS='|' read -r P_ID P_NAME P_SERVICE P_KIND P_TIMES P_DAYS P_MIN P_ON P_MAX <<<"$1"
    P_ID=$(trim "$P_ID"); P_NAME=$(trim "$P_NAME"); P_SERVICE=$(trim "$P_SERVICE"); P_KIND=$(trim "$P_KIND")
    P_TIMES=$(trim "$P_TIMES"); P_DAYS=$(trim "$P_DAYS"); P_MIN=$(trim "$P_MIN")
    P_ON=$(trim "$P_ON"); P_MAX=$(trim "$P_MAX")
}

# 今天是不是该跑(星期):空 = 每天;否则是逗号分隔的 1-7
day_ok() {
    [ -z "$P_DAYS" ] && return 0
    local today; today=$(date +%u)
    case ",$P_DAYS," in *",$today,"*) return 0 ;; *) return 1 ;; esac
}

# 时间点判定:当前是否已到窗口里某个触发点
time_ok() {
    local now=$((10#$(date +%H) * 60 + 10#$(date +%M)))
    local part start end step hh base
    IFS=',' read -ra parts <<<"$P_TIMES"
    for part in "${parts[@]}"; do
        if [[ "$part" == *-* ]]; then                     # 区间/步长:05:00-19:30/30
            start=${part%%-*}; end=${part#*-}; step=30
            [[ "$end" == */* ]] && { step=${end#*/}; end=${end%%/*}; }
            hh=$((10#${start%%:*} * 60 + 10#${start#*:}))
            end=$((10#${end%%:*} * 60 + 10#${end#*:}))
            (( now < hh || now > end )) && continue
            # 容差 3 分钟:systemd 可能落在 :00:01,手工跑也可能差几十秒
            (( (now - hh) % step < 3 )) && return 0
        else                                               # 固定钟点:08:00 —— 到点后两小时内都算
            base=$((10#${part%%:*} * 60 + 10#${part#*:}))
            (( now >= base && now <= base + 120 )) && return 0
        fi
    done
    return 1
}

# 今天这个程序已经跑了几次(次数存在 state/runner/<id>.<日期>)
runs_today() {
    local f; f="$STATE_DIR/$P_ID.$(date +%F)"
    if [ -f "$f" ]; then cat "$f"; else echo 0; fi
}
bump_today() {
    local f; f="$STATE_DIR/$P_ID.$(date +%F)"
    echo $(( $(runs_today) + 1 )) >"$f"
}

# 该不该跑:启用 + 星期 + 钟点 + 次数
should_run() {
    [ "$P_ON" = "1" ] || { note "跳过 $P_NAME:已停用"; return 1; }
    day_ok || { note "跳过 $P_NAME:今天不是运行日"; return 1; }
    time_ok || return 1
    local used; used=$(runs_today)
    [ "$used" -lt "${P_MAX:-3}" ] || { note "跳过 $P_NAME:今天已跑 $used 次"; return 1; }
    return 0
}

# 启动一次容器,带看门狗。直接调 docker compose,不再经各程序自己的 run.sh。
run_container() {
    local minutes="${P_MIN:-30}" code=0 rotate="$STATE_DIR/$P_ID.log"
    mkdir -p "$STATE_DIR"
    # 每个程序一把自己的锁:同一个程序(比如微信读书)决不允许两个容器同时跑,
    # 否则两个进程同时写 data/ 会互相覆盖。名字与旧 run.sh 的锁一致,手工调用也受同一把锁保护。
    exec 8>"$SUITE_DIR/state/$P_ID.flock"
    if ! flock -n 8; then note "$P_NAME 已有一处在跑,本跳跳过"; exec 8>&-; return 0; fi
    : >"$rotate"
    note "启动 $P_NAME · 看门狗 ${minutes} 分钟"
    docker compose -f "$SUITE_DIR/compose.yaml" run --rm -T "$P_SERVICE" </dev/null >>"$rotate" 2>&1 &
    local pid=$!
    (
        exec </dev/null >/dev/null 2>&1; exec 8>&-; exec 9>&-
        sleep $((minutes * 60))
        kill -0 "$pid" 2>/dev/null || exit 0
        echo "[WATCHDOG] ${minutes} 分钟未结束,强制停止" >>"$rotate"
        docker ps -aq --filter "label=com.docker.compose.service=$P_SERVICE" | xargs -r docker rm -f >/dev/null 2>&1
        kill "$pid" 2>/dev/null
    ) &
    local wd=$!
    wait "$pid"; code=$?
    pkill -P "$wd" 2>/dev/null; kill "$wd" 2>/dev/null; wait "$wd" 2>/dev/null
    exec 8>&-
    bump_today
    note "$P_NAME 退出码 $code"
    # 崩在发消息之前(退出码非 0 且日志里没有 [完成])才补一条提醒,守卫跳过不打扰
    if [ "$code" -ne 0 ] && ! grep -q "\[完成\]" "$rotate"; then
        node "$SUITE_DIR/alert-fail.mjs" "$P_NAME" "退出码 $code" "$rotate" >>"$LOG" 2>&1 || true
    fi
    return "$code"
}

# ── 入口 ────────────────────────────────────────────────────────────────────
mkdir -p "$STATE_DIR"
exec 9>"$LOCK"
if ! flock -n 9; then note "已有一次控制进程在跑,本次跳过"; exit 0; fi

PLAN_ONLY=0
FORCE_ID=""
for arg in "$@"; do
    case "$arg" in
        --plan) PLAN_ONLY=1 ;;
        -*) note "未知参数:$arg"; exit 2 ;;
        *) FORCE_ID="$arg" ;;
    esac
done

note "===== tick:${*:-自动} ====="

# 强制指定某个程序时,只看它一个
if [ -n "$FORCE_ID" ]; then
    for row in "${PROGRAMS[@]}"; do
        parse_row "$row"
        [ "$P_ID" = "$FORCE_ID" ] || continue
        if [ "$PLAN_ONLY" = "1" ]; then note "计划:启动 $P_NAME"; else run_container; fi
        exit $?
    done
    note "没有这个程序:$FORCE_ID"; exit 2
fi

# 第一轮:每日任务,按表顺序串行跑完(与旧 run-all.sh 一致)
DID=0
for row in "${PROGRAMS[@]}"; do
    [ -z "$(trim "$row")" ] && continue
    parse_row "$row"
    [ "$P_KIND" = "daily" ] || continue
    should_run || continue
    if [ "$PLAN_ONLY" = "1" ]; then note "计划:启动 $P_NAME · 今天已跑 $(runs_today) 次 / 上限 ${P_MAX}"; DID=1; continue; fi
    run_container; DID=1
done

# 第二轮:没有每日任务可跑时,补一条读时长(一次一个会话,下一跳接着来)
if [ "$DID" = "0" ]; then
    for row in "${PROGRAMS[@]}"; do
        [ -z "$(trim "$row")" ] && continue
        parse_row "$row"
        [ "$P_KIND" = "reader" ] || continue
        should_run || continue
        if [ "$PLAN_ONLY" = "1" ]; then note "计划:启动 $P_NAME · 今天已跑 $(runs_today) 次 / 上限 ${P_MAX}"; DID=1; continue; fi
        run_container; DID=1; break
    done
fi

[ "$DID" = "1" ] || note "本跳无事可做"
exit 0
