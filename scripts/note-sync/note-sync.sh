#!/usr/bin/env bash
# 本机 0-Note 同步(三端同步的本机侧):本机 → GitHub → 服务器,以远程仓库为主。
# 由 Windows 计划任务每 5 分钟调用一次;幂等,随时可以手动跑。
#
# 规则(2026-10-05 与用户确认):
#   1. 先 pull --rebase --autostash —— 远端为主,但绝不丢本地改动
#   2. 只提交"2 分钟没被改过"的文件 —— 这个库有多个 AI 会话同时写,
#      立刻 add 会把别人写了一半的文件提交进去
#   3. push 前跑脱敏闸门(check-privacy --staged):仓库是 public,命中即撤回暂存并通知
#   3b. push 前跑 0-Note 巡检(check_vault --fail-on):课件规范 / 断链 / 索引登记这类硬规则必须为 0,
#      历史欠账(A3 孤篇 / A5A6 元数据 / A8 标签)留在报告里但不拦(2026-10-06 加)
#   4. push 失败重试 3 次(每次先 rebase);冲突/被拒 → 停下 + 企业微信通知,绝不 force
#
# 配置:~/.note-sync/config.env(机器私有,不入库)
#   NOTE_DIR=/f/0-Note
#   HAC_DIR=/c/Users/23652/home-automation-configs
#   WECOM_WEBHOOK_FILE=~/.note-sync/wecom-server.txt   # 可选,失败时通知用(走"服务器"通道)
set -uo pipefail

CONFIG="${NOTE_SYNC_CONFIG:-$HOME/.note-sync/config.env}"
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && . "$CONFIG"
NOTE_DIR="${NOTE_DIR:-/f/0-Note}"
HAC_DIR="${HAC_DIR:-/c/Users/23652/home-automation-configs}"
QUIET_MIN="${NOTE_SYNC_QUIET_MIN:-2}"
LOG="${NOTE_SYNC_LOG:-$HOME/.note-sync/sync.log}"
# 冲突提示里指路用:服务器侧由入口脚本覆盖成自己的路径
NOTE_LABEL="${NOTE_LABEL:-本机 F:\0-Note}"
mkdir -p "$(dirname "$LOG")"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }

# 文本转 JSON 字符串(优先 python3,退回 python,再退回 sed)—— 失败通知要用
json_escape() {
    if command -v python3 >/dev/null 2>&1; then
        python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'
    elif command -v python >/dev/null 2>&1; then
        python -c 'import json,sys;print(json.dumps(sys.stdin.read()))'
    else
        sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g' | sed 's/^/"/;s/$/"/'
    fi
}

notify() {
    local text="$1" body
    log "通知:$text"
    [ -n "${WECOM_WEBHOOK_FILE:-}" ] || return 0
    [ -f "$WECOM_WEBHOOK_FILE" ] || return 0
    body="$(printf '%s' "$text" | json_escape)"
    curl -s -m 15 -X POST -H 'content-type: application/json' \
        -d "{\"msgtype\":\"text\",\"text\":{\"content\":$body}}" \
        "$(tr -d '\r\n' <"$WECOM_WEBHOOK_FILE")" >/dev/null 2>&1 || true
}

cd "$NOTE_DIR" 2>/dev/null || { log "找不到 $NOTE_DIR"; exit 2; }
git rev-parse --git-dir >/dev/null 2>&1 || { log "$NOTE_DIR 不是 git 仓库"; exit 2; }

# 通知博客重建(note 仓是纯内容仓,不再有 workflow —— 这件事改由仓外做)。
# 脚本真源:scripts/note-sync/notify-blog.sh。任何失败只记日志,绝不影响同步本身。
blog_guard() {
    local s="$HAC_DIR/scripts/note-sync/notify-blog.sh"
    [ -f "$s" ] || return 0   # 用 -f 不用 -x:git 里可能没记可执行位(服务器实测踩过)
    "$s" "$@" >>"$LOG" 2>&1 || log "博客通知脚本返回非零(忽略)"
}

# ── 1. 拉取(远端为主)────────────────────────────────────────────

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
    notify "0-Note 同步 · 需要你处理
请你:在 ${NOTE_LABEL} 里手动解决冲突后提交
原因:git pull --rebase 失败,自动同步已停下
不处理的后果:本机与远端会继续分叉,后面每次同步都会停"
    exit 1
fi
[ "$out" != "Already up to date." ] && log "pull:$out"

# ── 2. 挑出"已稳定"的改动(2 分钟没被改过)────────────────────────
declare -a READY=()
while IFS= read -r -d '' entry; do
    rel="${entry:3}"
    [ -z "$rel" ] && continue
    if [ -e "$rel" ] && [ -n "$(find "$rel" -mmin -"$QUIET_MIN" -print -quit 2>/dev/null)" ]; then
        log "跳过(刚被改过):$rel"
        continue
    fi
    READY+=("$rel")
done < <(git status --porcelain -z 2>/dev/null)

if [ "${#READY[@]}" -eq 0 ]; then
    # 没有新改动;若本地有未推送提交(别的会话提交过)也要推
    if [ "$(git log --oneline '@{u}..HEAD' 2>/dev/null | wc -l)" -eq 0 ]; then
        log "无改动、无待推送"
        blog_guard          # 兜底:每 30 分钟比一次(note HEAD vs 博客最近成功部署)+ 失败自愈
        exit 0
    fi
else
    git add -- "${READY[@]}" || { log "git add 失败"; exit 1; }
    log "暂存 ${#READY[@]} 个文件:${READY[*]}"
fi

# ── 3. 脱敏闸门(仓库是 public)────────────────────────────────────
if ! gate=$(node "$HAC_DIR/scripts/check-privacy.mjs" --staged 2>&1); then
    log "脱敏闸门拦下:$gate"
    git reset -q -- "${READY[@]}" >/dev/null 2>&1 || true   # 只撤回本次暂存的路径,别动别的会话已暂存的内容
    notify "0-Note 同步 · 需要你处理
请你:看本机 $LOG 的最近几行,删掉凭据或把文件加进 .gitignore
原因:push 前脱敏检查命中(个人标识或明文账号密码形状)
不处理的后果:这次不会推送 —— 仓库是公开的,推上去等于永久公开"
    exit 1
fi

# ── 3b. 巡检闸门(0-Note 自己的规则:课件规范 / 断链 / 索引登记)────
# 只拦「必须为 0」的阶段;A3/A5/A6/A8 是历史欠账,留在报告里但不拦。整轮检查约 2 秒。
VAULT_GATE_STAGES="${VAULT_GATE_STAGES:-A1,A2,A4,A7,A9,A10,A11,A12,A13,A14,A15,A16,A17,A18,A19,A20}"
if [ -f "$NOTE_DIR/50-资源/工具/vault-check/check_vault.py" ]; then
    PY="$(command -v python3 || command -v python || true)"
    if [ -z "$PY" ]; then
        log "跳过巡检闸门(没找到 python)"
    elif ! vault=$(cd "$NOTE_DIR" && PYTHONIOENCODING=utf-8 "$PY" -B \
             "50-资源/工具/vault-check/check_vault.py" --quiet --fail-on "$VAULT_GATE_STAGES" 2>&1); then
        log "巡检闸门拦下:$(printf '%s' "$vault" | tail -n 3 | tr '\n' ' ')"
        git reset -q -- "${READY[@]}" >/dev/null 2>&1 || true   # 只撤回本次暂存的路径
        notify "0-Note 同步 · 需要你处理
请你:在 ${NOTE_LABEL} 里跑 python3 -B 50-资源/工具/vault-check/check_vault.py --fail-on $VAULT_GATE_STAGES
原因:推送前巡检未通过(课件规范 / 断链 / 索引登记这类硬规则)
不处理的后果:这次不会推送 —— 先按报告改掉,或临时把该阶段从 VAULT_GATE_STAGES 里去掉"
        exit 1
    fi
fi

# ── 4. 提交并推送(失败重试 3 次)──────────────────────────────────
if [ "${#READY[@]}" -gt 0 ]; then
    # 必须用 pathspec 提交:git commit 默认提交**整个索引**,别的会话已暂存的文件会被一起带走
    # (2026-10-05 实测踩到:脚本判定"刚被改过"而跳过的文件,仍被提交了)
    git commit -q -m "chore(note): 自动同步 $(date '+%F %T')" -- "${READY[@]}" || { log "commit 失败"; exit 1; }
    log "已提交"
fi

for attempt in 1 2 3; do
    if out=$(timeout -k 5 "${NET_TIMEOUT:-150}" git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 push 2>&1); then
        log "push 成功(第 $attempt 次)"
        blog_guard --force --reason "note-sync 推送成功(第 $attempt 次)"   # 内容刚变:立即通知博客重建
        exit 0
    fi
    log "push 第 $attempt 次失败:$out"
    timeout -k 5 "${NET_TIMEOUT:-150}" git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 pull --rebase --autostash >/dev/null 2>&1 || { git rebase --abort >/dev/null 2>&1 || true; break; }
    sleep 3
done

notify "0-Note 同步 · 需要你处理
请你:在 ${NOTE_LABEL} 跑一次 git push 看报错
原因:自动推送连续 3 次失败(多半是远端有新提交或网络问题)
不处理的后果:本机改动还没上云,服务器也就拉不到"
exit 1
