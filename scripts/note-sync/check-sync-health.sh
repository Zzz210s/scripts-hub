#!/usr/bin/env bash
# 同步停摆体检(计划任务 NoteSyncHealth,每 5 分钟,用户上下文)。
# note-sync.sh 自己不说话时,由它来问三个问题:同步还在跑吗?有东西没出去吗?落后远端了吗?
#
# 判据(2026-10-14 与用户定):
#   ① 心跳超过 STALE_MIN(默认 20)分钟 —— 或者心跳文件根本不在 ——
#      且「工作树有未提交改动」或「本地领先 origin/master」
#      → 告警「本机同步停摆,有改动没出去」(这正是 2026-10-13 那次 11 小时静默的形状)
#   ② 落后远端连续 BEHIND_ROUNDS(默认 3)轮 → 告警「本机落后远端」
# 同类告警 30 分钟限流(notify_throttled);体检本身永远退出 0,告警失败不影响下一轮。
#
# 环境变量(都有默认值):
#   NOTE_SYNC_STALE_MIN 默认 20    NOTE_SYNC_BEHIND_ROUNDS 默认 3
#   NOTE_SYNC_HEALTH_LOG 默认 ~/.note-sync/health.log
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./note-sync-lib.sh
. "$SELF_DIR/note-sync-lib.sh"
LOG="${NOTE_SYNC_HEALTH_LOG:-$STATE_DIR/health.log}"   # 体检日志与 sync.log 分开,互不淹没
STALE_MIN="${NOTE_SYNC_STALE_MIN:-20}"
BEHIND_ROUNDS="${NOTE_SYNC_BEHIND_ROUNDS:-3}"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

cd "$NOTE_DIR" 2>/dev/null || { log "找不到 $NOTE_DIR"; exit 2; }
git rev-parse --git-dir >/dev/null 2>&1 || { log "$NOTE_DIR 不是 git 仓库"; exit 2; }

# ── 1. 读心跳:在多久以前、当时落后多少 ──────────────────────────
hb_age=""
hb_behind=0
if [ -f "$HEARTBEAT" ]; then
    at=$(sed -n 's/.*"at":"\([^"]*\)".*/\1/p' "$HEARTBEAT" | head -n 1)
    hb_behind=$(sed -n 's/.*"behind":\([0-9]*\).*/\1/p' "$HEARTBEAT" | head -n 1)
    if [ -n "$at" ]; then
        epoch=$(date -d "$at" +%s 2>/dev/null || echo '')
        [ -n "$epoch" ] && hb_age=$(( $(date +%s) - epoch ))
    fi
fi
if [ -z "$hb_age" ]; then
    age_txt="心跳不存在($HEARTBEAT 没有或读不出时间)"
    stale=1
else
    age_txt="心跳停在 $((hb_age / 60)) 分钟前"
    stale=0
    [ "$hb_age" -gt $((STALE_MIN * 60)) ] && stale=1
fi

# ── 2. 本地待同步量:未提交改动 / 领先 origin 的提交 ─────────────
dirty=$(git status --porcelain 2>/dev/null | head -n 1)
ahead=0
if git rev-parse -q --verify refs/remotes/origin/master >/dev/null 2>&1; then
    ahead=$(git rev-list --count refs/remotes/origin/master..HEAD 2>/dev/null || echo 0)
fi

if [ "$stale" = 1 ] && { [ -n "$dirty" ] || [ "${ahead:-0}" -gt 0 ]; }; then
    log "停摆告警:${age_txt};未提交改动 ${dirty:-无};领先 origin ${ahead} 个提交"
    notify_throttled sync-stall "内容仓 同步 · 本机同步停摆,有改动没出去
请你:在本机看 $LOG 最近几行,再确认计划任务 NoteSyncFast / NoteSync 是否在跑
原因:${age_txt},而工作树或本地提交还有没出去的内容(未提交:${dirty:-无};领先 origin:${ahead} 个提交)
不处理的后果:本机改动上不了云,服务器与博客都停在旧版本"
fi

# ── 3. 落后远端:连续 BEHIND_ROUNDS 轮才算数 ─────────────────────
behind=0
if timeout -k 5 60 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 fetch -q origin master 2>/dev/null \
   && git rev-parse -q --verify refs/remotes/origin/master >/dev/null 2>&1; then
    behind=$(git rev-list --count HEAD..refs/remotes/origin/master 2>/dev/null || echo 0)
else
    behind="${hb_behind:-0}"   # 拉不到远端就退回心跳里的数字,不在这里报链路问题(那是 note-sync 的事)
fi

if [ "${behind:-0}" -gt 0 ]; then
    n=$(cat "$BEHIND_COUNT_FILE" 2>/dev/null || echo 0)
    case "$n" in ''|*[!0-9]*) n=0 ;; esac
    n=$((n + 1))
    printf '%s\n' "$n" >"$BEHIND_COUNT_FILE"
    log "落后远端:behind=$behind,连续 $n 轮"
    if [ "$n" -ge "$BEHIND_ROUNDS" ]; then
        notify_throttled sync-behind "内容仓 同步 · 本机落后远端
请你:在本机跑一次 bash -lc $SELF_DIR/note-sync.sh,看它为什么拉不下来
原因:连续 $n 轮检测到本地落后 origin/master $behind 个提交
不处理的后果:本机内容停在旧版本,与服务器 / 博客不一致"
    fi
else
    [ -f "$BEHIND_COUNT_FILE" ] && rm -f "$BEHIND_COUNT_FILE"
fi

exit 0
