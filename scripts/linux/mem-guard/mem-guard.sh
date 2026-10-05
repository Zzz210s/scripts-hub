#!/usr/bin/env bash
# 内存守卫:swap 快满 + 负载高时,杀掉 VS Code 远端的扩展宿主,保住整机的响应性。
#
# 为什么需要(2026-10-05 实测):VS Code 远端一个扩展宿主进程吃掉了 3.45 GB swap,
# 4 GB swap 全满,load 冲到 39(2 核),SSH 认证卡住 —— 机器 TCP 通、ping 通,但登不上去。
# earlyoom 的判据是"内存与 swap 同时低于阈值"(AND),当时内存还有 40%,所以它不触发。
#
# 只杀 vscode-server:pi / tmux 会话是用户的 AI 会话,绝不能动(它们的内存占用小得多)。
# 由 mem-guard.timer 每 5 分钟跑一次;也可以在排查时手动跑(加 --dry 只看不杀)。
set -uo pipefail

DRY=0
[ "${1:-}" = "--dry" ] && DRY=1
LOG="${MEM_GUARD_LOG:-/srv/apps/automation/logs/mem-guard.log}"
WEBHOOK_FILE="${MEM_GUARD_WEBHOOK:-/srv/apps/automation/weread/secrets/wecom-webhook.txt}"
SWAP_FREE_MIN="${SWAP_FREE_MIN:-10}"   # swap 剩余百分比低于这个值
LOAD_FACTOR="${LOAD_FACTOR:-2}"        # load 高于 核数 x 这个倍数

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }

notify() {
    log "通知:$1"
    [ -f "$WEBHOOK_FILE" ] || return 0
    python3 - "$WEBHOOK_FILE" "$1" <<'PY' >/dev/null 2>&1 || true
import json, sys, urllib.request
url = open(sys.argv[1]).read().strip()
body = json.dumps({"msgtype": "text", "text": {"content": sys.argv[2]}}).encode()
urllib.request.urlopen(urllib.request.Request(url, body, {"content-type": "application/json"}), timeout=15)
PY
}

read -r swap_total swap_free < <(awk '/^SwapTotal:/ {t=$2} /^SwapFree:/ {f=$2} END {print t, f}' /proc/meminfo)
[ "${swap_total:-0}" -gt 0 ] || exit 0
swap_free_pct=$((swap_free * 100 / swap_total))
cores=$(nproc)
load1=$(awk '{print int($1)}' /proc/loadavg)
load_limit=$((cores * LOAD_FACTOR))

log "检查:swap 剩余 ${swap_free_pct}% (阈值 ${SWAP_FREE_MIN}%),load ${load1} (阈值 ${load_limit})"

if [ "$swap_free_pct" -ge "$SWAP_FREE_MIN" ] || [ "$load1" -le "$load_limit" ]; then
    exit 0
fi

# 找 vscode-server 里 RSS 最大的那个(扩展宿主)
read -r target rss_kb <<<"$(ps -eo rss,pid,args --sort=-rss | awk '/vscode-server\/cli\/servers/ && !/awk/ {print $2, $1; exit}')"
if [ -z "${target:-}" ]; then
    log "swap 紧张但没有 vscode-server 进程,不动手"
    exit 0
fi

if [ "$DRY" -eq 1 ]; then
    log "[dry] 本该杀掉 pid $target(RSS $((rss_kb / 1024)) MB)"
    echo "dry-run:会杀掉 pid $target (RSS $((rss_kb / 1024)) MB)"
    exit 0
fi

log "swap 紧张:杀 vscode-server pid $target(RSS $((rss_kb / 1024)) MB)释放内存"
kill -TERM "$target" 2>/dev/null || true
for _ in $(seq 1 10); do
    kill -0 "$target" 2>/dev/null || break
    sleep 2
done
kill -KILL "$target" 2>/dev/null || true

notify "服务器内存告急 · 已自动处理
原因:swap 只剩 ${swap_free_pct}%、load ${load1}(${cores} 核),VS Code 远端扩展宿主占了大头
已做:杀掉该进程释放内存(VS Code 窗口会自动重连并重启远端服务)
不处理的后果:没有这一步整机会卡到 SSH 都登不上"
