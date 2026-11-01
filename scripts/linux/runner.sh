#!/usr/bin/env bash
# 唯一的启动控制:所有程序容器都从这里起。改这一个文件就够了。
#   runner.sh | runner.sh --plan | runner.sh <id>
# systemd 每 30 分钟调一次(automation-runner.timer):每日任务先跑(串行),都跑不了再补读时长。
set -uo pipefail
# ─── 设置区:人改这里。一行一个程序,顺序就是执行顺序 ──────────────────────────
#  字段依次: id | 显示名 | 服务 | daily/reader | 钟点 | 星期(1-7,空=每天) | 看门狗分钟 | 启用 | 一天几次
#  daily 按表顺序串行跑完,次数建议 1(一天几档就写几档,写 3 会在一个窗口里连跑三遍)。
#  reader=后台静默补时长;report=后台跑但要发消息(微信读书日报,一次跑一两小时,不能占着控制进程)。
#  微软积分沿用 08:00/12:00/19:00 三档(用户 2026-11-01 要求恢复原设定)。钟点 "08:00" 到点后两小时内算触发,
#  "00:00-19:59/30" 表示该区间每 30 分钟一跳都算。
PROGRAMS=(
# id        显示名       服务           类别    钟点                          星期  看门狗  启用  次数
  "rewards  |微软积分    |rewards-run   |daily  |08:00,12:00,19:00            |     |150   |1    |1"
  "epic     |Epic 限免   |epic-run      |daily  |08:00,12:00,19:00            |5    |40    |1    |1"
  "bilibili |B站任务     |bilibili-run  |daily  |08:00,12:00,19:00            |     |120   |1    |1"
  "tieba    |百度贴吧    |tieba-run     |daily  |08:00,12:00,19:00            |     |75    |1    |1"
  "netease  |网易云      |netease-run   |daily  |08:00,12:00,19:00            |     |60    |1    |1"
  # 微信读书两行:report 只发每天一条带结果的日报;reader 在后台静默补时长(被让路停掉也不留半句话)。
  "weread-report|微信读书日报|weread-run |report |19:00                        |     |120   |1    |1"
  "weread   |微信读书    |weread-run    |reader |00:00-19:59/30,23:00-23:59/30|     |720   |1    |12"
)
SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
STATE_DIR="$SUITE_DIR/state/runner"
LOG="$SUITE_DIR/logs/runner.log"
LOCK="$SUITE_DIR/state/runner.lock"   # 单实例:两个 tick 撞上只让一个进去
# ─── 逻辑区:一般不用动,要加程序只改上面的表 ─────────────────────────────────
note() { mkdir -p "$(dirname "$LOG")"; echo "[$(date +%F) $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; echo "${s%"${s##*[![:space:]]}"}"; }
# 拆一行表格 → 全局变量 P_ID/P_NAME/P_SERVICE/P_TIMES/P_DAYS/P_MIN/P_ON/P_MAX
parse_row() {
    IFS='|' read -r P_ID P_NAME P_SERVICE P_KIND P_TIMES P_DAYS P_MIN P_ON P_MAX <<<"$1"
    P_ID=$(trim "$P_ID"); P_NAME=$(trim "$P_NAME"); P_SERVICE=$(trim "$P_SERVICE"); P_KIND=$(trim "$P_KIND")
    P_TIMES=$(trim "$P_TIMES"); P_DAYS=$(trim "$P_DAYS"); P_MIN=$(trim "$P_MIN"); P_ON=$(trim "$P_ON"); P_MAX=$(trim "$P_MAX")
}
# 今天是不是该跑(星期):空 = 每天;否则是逗号分隔的 1-7
day_ok() {
    [ -z "$P_DAYS" ] && return 0
    case ",$P_DAYS," in *",$(date +%u),"*) return 0 ;; *) return 1 ;; esac
}
# 当前命中的钟点(空=不在窗口):固定钟点看 2 小时窗口,区间写法看步长。
slot_of() {
    local now=$((10#$(date +%H) * 60 + 10#$(date +%M))) part start end step hh base
    IFS=',' read -ra parts <<<"$P_TIMES"
    for part in "${parts[@]}"; do
        if [[ "$part" == *-* ]]; then
            start=${part%%-*}; end=${part#*-}; step=30
            [[ "$end" == */* ]] && { step=${end#*/}; end=${end%%/*}; }
            hh=$((10#${start%%:*} * 60 + 10#${start#*:}))
            end=$((10#${end%%:*} * 60 + 10#${end#*:}))
            (( now < hh || now > end )) && continue
            (( (now - hh) % step < 3 )) && { echo "$part"; return 0; }
        else
            base=$((10#${part%%:*} * 60 + 10#${part#*:}))
            (( now >= base && now <= base + 120 )) && { echo "$part"; return 0; }
        fi
    done
    return 1
}

# 今天这个程序已经跑了几次(次数存在 state/runner/<id>.<日期>)
# 计数按「程序·日期·钟点」:同一个 08:00 档只跑一次,12:00 / 19:00 各再来一次。
# 只按日期计会在 08:00-10:00 这个窗口里连跑三遍(2026-11-01 实测)。
slot_file() { echo "$STATE_DIR/$P_ID.$(date +%F).${1:-none}"; }
slot_runs() {
    local f; f=$(slot_file "$1")
    if [ -f "$f" ]; then cat "$f"; else echo 0; fi
}
ran_today() { local f; f=$(slot_file none); [ -f "$f" ] && return 0; ls "$STATE_DIR/$P_ID.$(date +%F)."* >/dev/null 2>&1; }
bump_slot() { local f; f=$(slot_file "$1"); echo $(( $(slot_runs "$1") + 1 )) >"$f"; }
# 当天第一个钟点是否已过(补跑用:错过窗口也要跑一次,免得一整天白过)
first_point_passed() {
    local now=$((10#$(date +%H) * 60 + 10#$(date +%M))) part base first=9999
    IFS=',' read -ra parts <<<"$P_TIMES"
    for part in "${parts[@]}"; do
        part=${part%%-*}
        base=$((10#${part%%:*} * 60 + 10#${part#*:}))
        (( base < first )) && first=$base
    done
    (( now >= first ))
}
# 该不该跑。今天还没跑过时只要过了第一个钟点就跑(补跑),否则看窗口。
# 2026-11-01 微信读书把上午占满,贴吧/B站/网易云整天没跑 —— 补跑这条就是为它加的。
should_run() {
    [ "$P_ON" = "1" ] || { note "跳过 $P_NAME:已停用"; return 1; }
    day_ok || { note "跳过 $P_NAME:今天不是运行日"; return 1; }
    if ! ran_today; then                       # 今天一次都没跑:过了第一个钟点就补跑
        first_point_passed || return 1
        note "$P_NAME 今天还没跑过,补跑"
        SLOT=补跑
        return 0
    fi
    SLOT=$(slot_of) || return 1                # 其余情况只在窗口里跑
    local used; used=$(slot_runs "$SLOT")
    [ "$used" -lt "${P_MAX:-1}" ] || { note "跳过 $P_NAME:$SLOT 这一档已跑过"; return 1; }
    return 0
}
# 让路:每日任务要跑时,把还在读的 reader 容器停掉(阅读进度按分钟落库,下一跳接着读)。
stop_readers() {
    local row id svc kind ids
    for row in "${PROGRAMS[@]}"; do
        IFS='|' read -r id _ svc kind _ <<<"$row"
        [ "$(trim "$kind")" = "reader" ] || continue
        ids=$(docker ps -q --filter "label=com.docker.compose.service=$(trim "$svc")")
        [ -z "$ids" ] && continue
        note "让路:停掉正在跑的 $(trim "$id")"
        docker stop -t 30 $ids >/dev/null 2>&1 || true
    done
}
# 启动一次。实际执行交给各程序自己的 run.sh:日志轮转、尝试计数、企业微信汇总、
# 崩溃兜底都在那里,绕过去就等于「跑是跑了,但没有任何消息」—— 2026-11-01 微软积分就是这样。
run_container() {
    local minutes="${P_MIN:-30}" code=0 rotate="$STATE_DIR/$P_ID.log" dir="${P_SERVICE%-run}"
    mkdir -p "$STATE_DIR"; : >"$rotate"
    [ "$P_KIND" = "daily" ] && stop_readers
    note "启动 $P_NAME · 看门狗 ${minutes} 分钟"
    if [ "$P_KIND" = "reader" ] || [ "$P_KIND" = "report" ]; then
        # 后台补时长:静默(不发开始/结果),否则一被让路停掉就剩半句话 —— 2026-11-01 收了四条
        # 「开始自动阅读」没有一条结果。锁用 reader 自己的那份,名字与 weread/run.sh 相同,
        # 保证日报那次与补时长那次不会同时读。
        exec 7>"$SUITE_DIR/state/$dir.flock"
        if ! flock -n 7; then note "$P_NAME 已有一处在跑,本跳跳过"; exec 7>&-; return 0; fi
        # reader 静默(被让路停掉也不留半句话);report 照常发消息
        local quiet=""
        [ "$P_KIND" = "reader" ] && quiet="-e QUIET_NOTICES=1"
        setsid nohup timeout -k 30 "${minutes}m" docker compose -f "$SUITE_DIR/compose.yaml"             run --rm -T $quiet "$P_SERVICE" </dev/null >>"$rotate" 2>&1 9>&- &
        disown 2>/dev/null || true
        bump_slot "${SLOT:-none}"
        note "$P_NAME 已在后台开始,本跳立刻返回"
        return 0
    fi
    timeout -k 30 "${minutes}m" "$SUITE_DIR/$dir/run.sh" </dev/null >>"$rotate" 2>&1 9>&-
    code=$?
    bump_slot "${SLOT:-none}"
    note "$P_NAME 退出码 $code"
    return "$code"
}

# 计划模式只报,真跑就起容器
launch() {
    if [ "$PLAN_ONLY" = "1" ]; then
        note "计划:启动 $P_NAME · 档位 ${SLOT:-补跑}"
    else
        run_container
    fi
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
        launch; exit $?
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
    launch; DID=1
done
# 第二轮:没有每日任务可跑时,补一条读时长(一次一个会话,下一跳接着来)
if [ "$DID" = "0" ]; then
    for row in "${PROGRAMS[@]}"; do
        [ -z "$(trim "$row")" ] && continue
        parse_row "$row"
        [ "$P_KIND" = "reader" ] || continue
        should_run || continue
        launch; DID=1; break
    done
fi
[ "$DID" = "1" ] || note "本跳无事可做"
exit 0
