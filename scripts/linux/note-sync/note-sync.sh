#!/usr/bin/env bash
# 服务器侧 0-Note 同步(三端同步的服务器侧):以远程仓库为主。
# 由 note-sync.timer 每 5 分钟调用;幂等,可手动跑。
#
#   pull --rebase --autostash  服务器上可能有 AI 会话改过笔记,不能直接覆盖
#   有本地提交就 push           失败重试 3 次
#   冲突/被拒 → 停下 + 企业微信通知(绝不 force)
#
# 拉取成功后**不需要**额外动作:博客重建脚本按 note 工作树的 sha 变化自动重建
# (见 /srv/apps/blog/rebuild.sh)。
#
# 配置:/srv/apps/automation/suite.env 里的 NOTE_DIR、NOTE_WECOM_WEBHOOK(可选)
#
# 注意:github.com 在这台机器上时通时断,所以所有联网操作都套了 timeout(NET_TIMEOUT,默认 120 秒),
# 否则一次卡住的 pull 会让 oneshot 单元一直不退出(2026-10-05 实测:手动 start 后 15 分钟仍在跑)。
set -uo pipefail

NOTE_DIR="${NOTE_DIR:-/srv/apps/note/repo}"
WEBHOOK_FILE="${NOTE_WECOM_WEBHOOK:-/srv/apps/automation/weread/secrets/wecom-webhook.txt}"
LOG="${NOTE_SYNC_LOG:-/srv/apps/automation/logs/note-sync.log}"
mkdir -p "$(dirname "$LOG")"

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

cd "$NOTE_DIR" 2>/dev/null || { log "找不到 $NOTE_DIR"; exit 2; }
git rev-parse --git-dir >/dev/null 2>&1 || { log "$NOTE_DIR 不是 git 仓库"; exit 2; }


# ── 拉取前:把"远端已有、本地未跟踪且同名"的文件移开 ──────────────────────────
# 否则 git 直接拒绝合并(untracked working tree files would be overwritten by merge)。
# 2026-10-05 实测:另一个会话在服务器上新建了 app_static.py,而远端也有同名文件,
# 每次 pull 都失败并通知"需要你处理",但其实与远端内容完全一致。
# 处理方式:移到备份目录(绝不删除),拉取完在日志里说明。
move_conflicting_untracked() {
    local branch f moved=0 backup
    branch="$(git rev-parse --abbrev-ref HEAD)"
    backup="${NOTE_UNTRACKED_BACKUP:-$HOME/.note-sync/untracked-backup/$(date +%F)}"
    timeout -k 5 "${NET_TIMEOUT:-150}" git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 fetch -q origin "$branch" 2>/dev/null || return 0
    while IFS= read -r -d '' entry; do
        case "${entry:0:3}" in
            '?? '*) f="${entry:3}" ;;
            *) continue ;;
        esac
        git cat-file -e "origin/$branch:$f" 2>/dev/null || continue
        mkdir -p "$backup/$(dirname "$f")" 2>/dev/null
        if mv -- "$f" "$backup/$f" 2>/dev/null; then
            moved=$((moved + 1))
            log "移开未跟踪同名文件:$f"
        fi
    done < <(git status --porcelain -z)
    [ "$moved" -gt 0 ] && log "共移开 $moved 个未跟踪同名文件到 $backup(是移动不是删除)"
    return 0
}

move_conflicting_untracked

if ! out=$(timeout -k 5 "${NET_TIMEOUT:-150}" git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 pull --rebase --autostash 2>&1); then
    git rebase --abort >/dev/null 2>&1 || true
    log "pull 失败:$out"
    notify "0-Note 同步(服务器)· 需要你处理
请你:在服务器 $NOTE_DIR 里手动解决冲突
原因:git pull --rebase 失败,服务器侧同步已停下
不处理的后果:服务器这份会停在旧版本,博客也就不会更新"
    exit 1
fi
[ "$out" != "Already up to date." ] && log "pull:$out"

ahead="$(git log --oneline '@{u}..HEAD' 2>/dev/null | wc -l)"
if [ "$ahead" -eq 0 ]; then
    log "无待推送(pull 已完成)"
    exit 0
fi

for attempt in 1 2 3; do
    if out=$(timeout -k 5 "${NET_TIMEOUT:-150}" git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 push 2>&1); then
        log "push 成功(第 $attempt 次,共 $ahead 个提交)"
        exit 0
    fi
    log "push 第 $attempt 次失败:$out"
    timeout -k 5 "${NET_TIMEOUT:-150}" git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 pull --rebase --autostash >/dev/null 2>&1 || { git rebase --abort >/dev/null 2>&1 || true; break; }
    sleep 3
done

notify "0-Note 同步(服务器)· 需要你处理
请你:在服务器 $NOTE_DIR 跑一次 git push 看报错
原因:自动推送连续 3 次失败
不处理的后果:服务器上的改动没上云,本机也就拉不到"
exit 1
