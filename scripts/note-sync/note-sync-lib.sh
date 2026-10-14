#!/usr/bin/env bash
# note-sync 本机侧公共层:配置、日志、通知、锁、心跳、告警限流。
# 由 note-sync.sh(同步)与 check-sync-health.sh(停摆体检)source;只定义函数与变量,
# 唯一的副作用是建好 ~/.note-sync 与日志目录。
#
# 契约(2026-10-14 与用户定):
#   心跳 $HEARTBEAT(JSON 一行):
#     {"at":"<本地时间 YYYY-MM-DD HH:MM:SS>","head":"<本地 HEAD sha>",
#      "remote_head":"<GitHub master sha,取不到填空>","ahead":N,"behind":N,
#      "ok":true|false,"note":"<说明>"}
#   锁 $LOCK_DIR:目录锁(mkdir 原子);存在且超过 $LOCK_STALE_SEC 视为陈旧,可抢占
#   告警限流:同类告警 $ALERT_WINDOW 秒内只发一条(键 + 时间戳落盘,见 notify_throttled)
#
# 可覆盖的环境变量(NOTE_* 前缀,一般写在 ~/.note-sync/config.env):
#   NOTE_SYNC_STATE_DIR 状态目录,默认 ~/.note-sync
#   NOTE_SYNC_QUIET_MIN 静默窗分钟,默认 1
#   NOTE_SYNC_LOCK_STALE_SEC 锁陈旧秒数,默认 1200
#   NOTE_SYNC_ALERT_WINDOW 同类告警限流秒数,默认 1800

CONFIG="${NOTE_SYNC_CONFIG:-$HOME/.note-sync/config.env}"
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && . "$CONFIG"
NOTE_DIR="${NOTE_DIR:-/f/0-Note}"
HAC_DIR="${HAC_DIR:-/c/Users/23652/home-automation-configs}"
QUIET_MIN="${NOTE_SYNC_QUIET_MIN:-1}"
LOG="${NOTE_SYNC_LOG:-$HOME/.note-sync/sync.log}"
# 冲突/告警里指路用:服务器侧由入口脚本覆盖成自己的路径
NOTE_LABEL="${NOTE_LABEL:-本机内容仓}"
STATE_DIR="${NOTE_SYNC_STATE_DIR:-$HOME/.note-sync}"
HEARTBEAT="$STATE_DIR/heartbeat.json"
LOCK_DIR="$STATE_DIR/run.lock"
LOCK_STALE_SEC="${NOTE_SYNC_LOCK_STALE_SEC:-1200}"
ALERT_WINDOW="${NOTE_SYNC_ALERT_WINDOW:-1800}"
PULL_FAIL_FILE="$STATE_DIR/pull-fail.count"
BEHIND_COUNT_FILE="$STATE_DIR/behind.count"
mkdir -p "$STATE_DIR/alerts" "$(dirname "$LOG")" 2>/dev/null || true

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }

notify() {
    # 真正的发送在 scripts/note-sync/notify-wecom.sh:统一按 UTF-8 编解码、超长截断、校验 errcode。
    # 本机侧 2026-10-11 的乱码事故就出在这一层(老实现用 sys.stdin.read() 读 cp936 的 stdin),
    # 抽出去既让修复只有一份,也守住本文件 200 行上限。
    log "通知:$1"
    [ -n "${WECOM_WEBHOOK_FILE:-}" ] || return 0
    local helper="$HAC_DIR/scripts/note-sync/notify-wecom.sh"
    if [ ! -f "$helper" ]; then
        log "通知未发送:找不到 $helper"
        return 0
    fi
    WECOM_WEBHOOK_FILE="$WECOM_WEBHOOK_FILE" bash "$helper" "$1" >>"$LOG" 2>&1 \
        || log "通知未送达(原因见上一行)"
}

# 同类告警限流:窗口内只发一条。键是告警类别(固定字符串),时间戳落 $STATE_DIR/alerts/<键>.stamp。
# 不进程内计数,是因为每次同步都是新进程;限流必须跨进程、跨计划任务实例。
notify_throttled() {   # <键> <正文>
    local key="$1" text="$2" f now last
    f="$STATE_DIR/alerts/$key.stamp"
    now=$(date +%s)
    last=$(cat "$f" 2>/dev/null || echo 0)
    case "$last" in ''|*[!0-9]*) last=0 ;; esac
    if [ $((now - last)) -lt "$ALERT_WINDOW" ]; then
        log "告警限流(${key}):距上次 $((now - last))s < ${ALERT_WINDOW}s,不重复发"
        return 0
    fi
    printf '%s\n' "$now" >"$f"
    notify "$text"
}

# 目录锁:mkdir 原子。拿不到锁就意味着「另一个实例正在跑」——那种情况安静退出,不算失败。
# 锁比 LOCK_STALE_SEC 还旧 = 上次被强杀(计划任务超时 / 关机),抢占重跑。
acquire_lock() {
    mkdir -p "$STATE_DIR" 2>/dev/null
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        printf '%s\n' "$$" >"$LOCK_DIR/pid"
        return 0
    fi
    local now mtime age holder
    now=$(date +%s)
    mtime=$(stat -c %Y "$LOCK_DIR" 2>/dev/null || stat -f %m "$LOCK_DIR" 2>/dev/null || echo "$now")
    age=$((now - mtime))
    holder=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo '?')
    if [ "$age" -gt "$LOCK_STALE_SEC" ]; then
        log "锁陈旧(${age}s > ${LOCK_STALE_SEC}s,pid $holder),抢占重跑"
        rm -rf "$LOCK_DIR"
        if mkdir "$LOCK_DIR" 2>/dev/null; then
            printf '%s\n' "$$" >"$LOCK_DIR/pid"
            return 0
        fi
    fi
    log "已有同步在跑(pid $holder,锁龄 ${age}s),本轮安静退出"
    return 1
}

release_lock() { rm -rf "$LOCK_DIR" 2>/dev/null || true; }

# 心跳:契约字段固定;note 里的双引号去掉(不做 JSON 转义,保证一行合法 JSON)。
# remote_head 取不到就留空(不报错);ahead/behind 相对本地 origin/master。
write_heartbeat() {   # <note> <ok:true|false>
    local note="${1:-}" ok="${2:-true}" head="" remote="" ahead=0 behind=0 counts
    head=$(git rev-parse HEAD 2>/dev/null || true)
    remote=$(timeout -k 5 20 git ls-remote origin refs/heads/master 2>/dev/null | awk 'NR==1{print $1}')
    if git rev-parse -q --verify refs/remotes/origin/master >/dev/null 2>&1; then
        [ -n "$remote" ] || remote=$(git rev-parse refs/remotes/origin/master 2>/dev/null || true)
        counts=$(git rev-list --left-right --count HEAD...refs/remotes/origin/master 2>/dev/null || echo '0 0')
        ahead=$(printf '%s' "$counts" | awk '{print $1+0}')
        behind=$(printf '%s' "$counts" | awk '{print $2+0}')
    fi
    printf '{"at":"%s","head":"%s","remote_head":"%s","ahead":%s,"behind":%s,"ok":%s,"note":"%s"}\n' \
        "$(date '+%F %T')" "$head" "$remote" "${ahead:-0}" "${behind:-0}" "$ok" "${note//\"/}" >"$HEARTBEAT"
}

# 通知博客重建(note 仓是纯内容仓,不再有 workflow —— 这件事改由仓外做)。
# 脚本真源:scripts/note-sync/notify-blog.sh。任何失败只记日志,绝不影响同步本身。
blog_guard() {
    local s="$HAC_DIR/scripts/note-sync/notify-blog.sh"
    [ -f "$s" ] || return 0   # 用 -f 不用 -x:git 里可能没记可执行位(服务器实测踩过)
    "$s" "$@" >>"$LOG" 2>&1 || log "博客通知脚本返回非零(忽略)"
}

# 提示里给 Windows 风格路径(人在 Windows 上照着敲命令)。
winpath() {
    if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1" 2>/dev/null || printf '%s' "$1"
    else printf '%s' "$1"; fi
}

# ── 推送前两道闸门 ───────────────────────────────────────────────
# 都在「已 git add、尚未 commit」时跑。通过返回 0;拦截返回 1,命中条目写进全局 GATE_HITS,
# 由调用方负责撤回暂存 + 发告警(撤回只动自己暂存的路径,别碰别的会话已暂存的内容)。

# 脱敏闸门:仓库是 public,命中个人标识或明文账号密码形状就不许推。
gate_privacy() {
    local gate
    if gate=$(node "$HAC_DIR/scripts/check-privacy.mjs" --staged 2>&1); then return 0; fi
    log "脱敏闸门拦下:$gate"
    GATE_HITS=$(printf '%s' "$gate" | head -3)
    return 1
}

# 巡检闸门(内容仓自己的规则:课件规范 / 断链 / 索引登记)。只拦「必须为 0」的阶段;
# A3/A5/A6/A8 是历史欠账,留在报告里但不拦。整轮检查约 2 秒。
#
# 脚本路径要容两个名字:库里 2026-10-13 把目录去掉了数字前缀(`50-资源` → `资源`)。
# 写死旧路径时的后果是**闸门静默失效** —— `[ -f … ]` 不成立就直接跳过,没日志没告警,
# 推送前巡检等于没跑(当天实测)。所以两个名字都试,都找不到才记一条日志说明。
gate_vault() {
    local stages check rel py vault
    stages="${VAULT_GATE_STAGES:-A1,A2,A3,A4,A5,A6,A7,A8,A9,A10,A11,A12,A13,A14,A15,A16,A17,A18,A19,A20,A22,A23}"
    VAULT_GATE_STAGES_USED="$stages"
    check=""
    for rel in "资源/工具/vault-check/check_vault.py" "50-资源/工具/vault-check/check_vault.py"; do
        if [ -f "$NOTE_DIR/$rel" ]; then check="$rel"; break; fi
    done
    if [ -z "$check" ]; then
        log "跳过巡检闸门(两个候选路径都没找到 check_vault.py)"
        return 0
    fi
    VAULT_CHECK_REL="$check"
    py="$(command -v python3 || command -v python || true)"
    if [ -z "$py" ]; then
        log "跳过巡检闸门(没找到 python)"
        return 0
    fi
    if vault=$(cd "$NOTE_DIR" && PYTHONIOENCODING=utf-8 "$py" -B \
             "$check" --fail-on "$stages" 2>&1); then
        return 0
    fi
    # 不加 --quiet:告警正文要带命中条目(2026-10-12 用户要求 —— 原先只说「先按报告改掉」,
    # 报告却不在通知里,收到告警的人得自己 ssh 进来翻)。只取「计入失败的阶段」的细目行。
    log "巡检闸门拦下:$(printf '%s' "$vault" | grep -E '^\[A[0-9]' | grep -v '不计入失败' | grep -v ' 0 处' | head -4 | tr '\n' ' ')"
    GATE_HITS=$(printf '%s' "$vault" | awk '/^\[/{ok=($0 ~ /^\[A[0-9]/ && $0 !~ /不计入失败/ && $0 !~ / 0 处/)} ok && /^   /{print}' | head -6)
    return 1
}

# 拉取前:把"远端已有、本地未跟踪且同名"的文件移开,否则 git 直接拒绝合并
# (untracked working tree files would be overwritten by merge)。
# 2026-10-05 实测:另一个会话在服务器上新建了 app_static.py,而远端也有同名文件,
# 每次 pull 都失败并通知"需要你处理",但其实与远端内容完全一致。
# 处理方式:移到备份目录(绝不删除),拉取完在日志里说明。
move_conflicting_untracked() {
    local branch f moved=0 backup
    branch="$(git rev-parse --abbrev-ref HEAD)"
    backup="${NOTE_UNTRACKED_BACKUP:-$STATE_DIR/untracked-backup/$(date +%F)}"
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
