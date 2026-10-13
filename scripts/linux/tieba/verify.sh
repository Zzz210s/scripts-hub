#!/usr/bin/env bash
# 贴吧签到的真机验证:一条命令跑完「只读体检 → 预览 → 可选真跑 → 汇总当天状态」。
#
#   scripts/linux/tieba/verify.sh           只做只读与预览,不碰账号
#   scripts/linux/tieba/verify.sh --real    追加一次真跑(会真的签到),这是唯一改状态的一步
#
# 为什么要这个脚本:真机验证要在「填完 .env 之后」按固定顺序看四样东西,少看一样就可能
# 把「对账没通过」当成「跑成功」。它只做顺序与汇总,判断留给人看输出。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
ROOT="$SUITE_DIR/tieba"
COMPOSE="$SUITE_DIR/compose.yaml"
REAL=0
[ "${1:-}" = "--real" ] && REAL=1

run() { docker compose -f "$COMPOSE" run --rm -T tieba-run "$@" < /dev/null; }

echo "== 1/4 只读体检:每个账号能不能取到 tbs、关注多少吧、其中已签多少"
run check || echo "[提示] check 退出码非 0 —— 有账号取不到 tbs 或关注列表,先解决它再往下走"

echo "== 2/4 预览:这会推送什么(不发送、不写状态)"
run run --dry

if [ "$REAL" -eq 1 ]; then
    echo "== 3/4 真跑一次:会对每个已关注吧发起签到"
    run run
    echo "== 4/4 当天状态与对账明细"
    echo "--- state.json(逐日 ok 与尝试次数)"
    sudo cat "$ROOT/data/state.json" 2>/dev/null | tail -20
    echo "--- history.jsonl 最后一条(逐账号结果 + 对账结论)"
    tail -1 "$ROOT/data/history.jsonl" 2>/dev/null
    echo
    echo "判据:结果消息标题写「运行成功」**且**正文有「对账:通过」才算真的签全;"
    echo "     只有标题成功而对账不通过,说明有吧没签上,当天不会锁定,下一次触发会重试。"
else
    echo "== 3/4 跳过真跑(要真跑就加 --real)"
fi
