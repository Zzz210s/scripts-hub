#!/usr/bin/env bash
# 编排用的守卫函数:启动前体检、跳过措辞、每周运行日、中断兜底。
# 从 run-all.sh 抽出(2026-10-26,守 200 行上限)。**只定义函数,不执行**;
# 由 run-all.sh 在 note() / enabled_in_schedule() / GATE / SCHEDULE 就绪之后 source 进来。
# 依赖调用方的这些符号:SUITE_DIR / GATE / SCHEDULE / GATE_MODE / note()

# 每周运行日:programs.<id>.linuxDays 声明后只在那些星期跑。取不到配置时按「该跑」——
# 宁可多跑一次(程序自己幂等)也不要在闸门坏掉的那天把周更漏掉。
due_in_schedule() {
    local id="$1" rc=1
    [ "$GATE_MODE" = "ok" ] || return 0
    node "$GATE" due "$SCHEDULE" "$id"
    rc=$?
    [ "$rc" -eq 0 ] && return 0
    [ "$rc" -eq 1 ] && return 1
    note "[警告] $id 运行日判定失败,退出码 $rc,按今天该跑处理"
    return 0
}

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
skip_note() {   # $1=显示名 $2=目录名 $3=程序 id
    if broken "$2"; then note "$1 跳过:宿主入口不可用"
    elif [ "$GATE_MODE" != "ok" ]; then note "$1 不在固定四程序清单里,跳过"
    elif enabled_in_schedule "$3" >/dev/null 2>&1; then note "$1 跳过:今天不是运行日"
    else note "$1 已关闭(schedule.json),跳过"
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
saved=0
# shellcheck disable=SC2154  # saved 由 trap 赋值后再用
trap 'saved=$?; on_exit "$saved"' EXIT
