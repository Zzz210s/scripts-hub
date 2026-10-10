#!/usr/bin/env bash
# 通知博客重建 —— note 仓(纯内容仓)不再有任何 workflow,这件事改由仓外的定时器做。
#
# 用法:
#   notify-blog.sh --force --reason "note-sync 刚推完"   # 即时:内容刚变,直接通知
#   notify-blog.sh                                      # 兜底:比一比再决定要不要通知
#   notify-blog.sh --dry-run                            # 只看判断结果,不发请求
#
# 兜底判断(任一成立就通知,否则什么都不做 —— 检查本身零成本、不消耗 Actions 分钟):
#   ① 自愈:博客仓最近一次 deploy 失败(failure / timed_out / cancelled)
#   ② 新鲜度:note 仓 HEAD 的提交时间 晚于 博客仓最近一次**成功** deploy 的时间
#      (覆盖「别处推来的改动」:别的机器、网页编辑、服务器会话)
# 防重:最近 DEDUPE_MIN 分钟内已有 deploy run(排队 / 跑着 / 刚成功)→ 跳过。
#   本机与服务器都跑同一个脚本,靠这条避免同一件事通知两次。
#
# 节流:兜底模式默认 30 分钟才真查一次(LAST_FILE 记时间戳);--force 不受节流限制。
# 环境变量(都有默认值,可在 config.env / suite.env 里覆盖):
#   NOTE_REPO  默认 Zzz210s/note            内容仓
#   BLOG_REPO  默认 Zzz210s/Zzz210s.github.io  博客仓
#   BLOG_WORKFLOW 默认 deploy.yml           博客仓里负责部署的工作流
#   DEDUPE_MIN 默认 5      GUARD_MIN 默认 30     LAST_FILE 默认 ~/.note-sync/.blog-guard-stamp
set -uo pipefail

NOTE_REPO="${NOTE_REPO:-Zzz210s/note}"
BLOG_REPO="${BLOG_REPO:-Zzz210s/Zzz210s.github.io}"
BLOG_WORKFLOW="${BLOG_WORKFLOW:-deploy.yml}"
DEDUPE_MIN="${DEDUPE_MIN:-5}"
GUARD_MIN="${GUARD_MIN:-30}"
LAST_FILE="${LAST_FILE:-$HOME/.note-sync/.blog-guard-stamp}"
LOG="${BLOG_GUARD_LOG:-$HOME/.note-sync/blog-guard.log}"
mkdir -p "$(dirname "$LOG")" "$(dirname "$LAST_FILE")" 2>/dev/null || true

FORCE=0
DRY=0
REASON="兜底检查"
while [ $# -gt 0 ]; do
    case "$1" in
        --force) FORCE=1 ;;
        --dry-run) DRY=1 ;;
        --reason) shift; REASON="${1:-兜底检查}" ;;
        *) echo "未知参数:$1" >&2; exit 2 ;;
    esac
    shift
done

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }
say() { [ "$DRY" = 1 ] && echo "$*"; log "$*"; }

command -v gh >/dev/null 2>&1 || { log "跳过:没找到 gh"; exit 0; }

# ── 1. 防重:最近有没有跑过 ──────────────────────────────────────
runs_json="$(timeout 30 gh api "repos/$BLOG_REPO/actions/workflows/$BLOG_WORKFLOW/runs?per_page=5" 2>/dev/null)" \
    || { log "跳过:查不到 $BLOG_REPO 的运行记录"; exit 0; }
recent="$(printf '%s' "$runs_json" | python3 -c '
import json, sys, datetime
d = json.load(sys.stdin)
mins = int(sys.argv[1])
now = datetime.datetime.now(datetime.timezone.utc)
for r in d.get("workflow_runs", []):
    t = datetime.datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
    if (now - t).total_seconds() < mins * 60:
        print("%s\t%s\t%s" % (r["created_at"], r["status"], r.get("conclusion") or "-"))
        break
' "$DEDUPE_MIN" 2>/dev/null)"
if [ -n "$recent" ]; then
    say "跳过:$DEDUPE_MIN 分钟内已有运行($recent)"
    exit 0
fi

# ── 2. 判断要不要通知 ────────────────────────────────────────────
need=0
if [ "$FORCE" = 1 ]; then
    need=1
    reason="即时通知:$REASON"
else
    # 节流:兜底模式 GUARD_MIN 分钟才真查一次
    now_epoch="$(date +%s)"
    if [ -f "$LAST_FILE" ]; then
        last="$(cat "$LAST_FILE" 2>/dev/null || echo 0)"
        if [ $((now_epoch - last)) -lt $((GUARD_MIN * 60)) ]; then
            exit 0   # 还没到下一次检查时间,静默退出
        fi
    fi
    echo "$now_epoch" >"$LAST_FILE"

    last_run="$(printf '%s' "$runs_json" | python3 -c '
import json, sys
d = json.load(sys.stdin)
r = (d.get("workflow_runs") or [{}])[0]
print("%s\t%s" % (r.get("created_at", ""), r.get("conclusion") or "-"))
' 2>/dev/null)"
    last_ok="$(timeout 30 gh api "repos/$BLOG_REPO/actions/workflows/$BLOG_WORKFLOW/runs?status=success&per_page=1" \
        --jq '.workflow_runs[0].created_at // ""' 2>/dev/null)"
    note_head="$(timeout 30 gh api "repos/$NOTE_REPO/commits/master" --jq '.commit.committer.date' 2>/dev/null)"
    lr_time="${last_run%%$'\t'*}"; lr_concl="${last_run##*$'\t'}"
    case "$lr_concl" in
        failure|timed_out|cancelled|startup_failure)
            need=1; reason="自愈:最近一次部署 $lr_concl($lr_time)" ;;
    esac
    if [ "$need" = 0 ] && [ -n "$note_head" ] && [ -n "$last_ok" ] && [ "$note_head" \> "$last_ok" ]; then
        need=1; reason="内容比部署新:note HEAD $note_head > 上次成功部署 $last_ok"
    fi
    if [ "$need" = 0 ] && [ -z "$last_ok" ]; then
        need=1; reason="博客仓还没有一次成功部署"
    fi
fi
[ "$need" = 1 ] || { say "跳过:内容不比部署新,也没有失败需要自愈"; exit 0; }

# ── 3. 通知 ─────────────────────────────────────────────────────
if [ "$DRY" = 1 ]; then
    say "将通知重建:$reason"
    exit 0
fi
if timeout 30 gh api "repos/$BLOG_REPO/dispatches" --method POST \
        -f event_type=content-updated -f client_payload[source]=note-sync-guard \
        -f client_payload[reason]="$reason" >/dev/null 2>&1; then
    log "已通知重建:$reason"
else
    log "通知失败(不影响同步):$reason"
fi
exit 0
