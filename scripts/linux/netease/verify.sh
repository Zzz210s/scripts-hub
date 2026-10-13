#!/usr/bin/env bash
# 网易云音乐签到的真机验证:一条命令跑完「只读探针 → 预览 → 可选真跑 → 汇总当天状态」。
#
#   scripts/linux/netease/verify.sh           只做只读与预览,不碰账号
#   scripts/linux/netease/verify.sh --real    追加一次真跑(会真的走 VIP 乐签)
#
# 探针那一步是刻意放前面的:它**绝不调用签到接口**,只用你的账号把「结果落在哪个字段」
# 实测一遍。探针结论要回填到 proj-netease-cloud/NOTICE 的待校正清单。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
ROOT="$SUITE_DIR/netease"
COMPOSE="$SUITE_DIR/compose.yaml"
REAL=0
[ "${1:-}" = "--real" ] && REAL=1

run() { docker compose -f "$COMPOSE" run --rm -T netease-run "$@" < /dev/null; }

echo "== 1/4 只读探针:签到状态与云贝余额各落在哪个字段(不签到、不写状态)"
run probe || echo "[提示] probe 退出码非 0 —— 有接口没通过,先看上面逐接口结果"

echo "== 2/4 预览:这会推送什么(不发送、不写状态)"
run run --dry

if [ "$REAL" -eq 1 ]; then
    echo "== 3/4 真跑一次:走 VIP 乐签两条请求,再读回业务结果"
    run run
    echo "== 4/4 当天状态"
    echo "--- state.json(逐日 ok、尝试次数、熔断标记)"
    sudo cat "$ROOT/data/state.json" 2>/dev/null | tail -20
    echo "--- history.jsonl 最后一条"
    tail -1 "$ROOT/data/history.jsonl" 2>/dev/null
    echo
    echo "判据:结果消息正文里乐签结论写「已签」才算生效;写「未能确认」说明读回没看出结果,"
    echo "     要按探针实测把字段名补进 src/fields.js 的候选表。"
else
    echo "== 3/4 跳过真跑(要真跑就加 --real)"
fi
