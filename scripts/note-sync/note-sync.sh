#!/usr/bin/env bash
# 本机内容仓同步(三端同步的本机侧):本机 → GitHub → 服务器,以远程仓库为主。
# 由 Windows 计划任务调用(NoteSyncFast 每 1 分钟 / NoteSync 每 5 分钟兜底);幂等,随时可以手动跑。
#
# 规则(2026-10-05 与用户确认;2026-10-14 加锁、心跳、失败计数):
#   0. 先抢锁 ~/.note-sync/run.lock:已有实例在跑就安静退出(退出码 0,不算失败)
#   1. 先 pull --rebase --autostash —— 远端为主,但绝不丢本地改动
#   2. 只提交"1 分钟没被改过"的文件 —— 这个库有多个 AI 会话同时写,
#      立刻 add 会把别人写了一半的文件提交进去
#   3. push 前跑脱敏闸门(check-privacy --staged):仓库是 public,命中即撤回暂存并通知
#   3b. push 前跑内容仓巡检(check_vault --fail-on):课件规范 / 断链 / 索引登记这类硬规则必须为 0,
#      历史欠账(A3 孤篇 / A5A6 元数据 / A8 标签)留在报告里但不拦(2026-10-06 加);
#      告警正文要带命中条目(2026-10-12 加 —— 原先只说「按报告改掉」,报告却不在通知里)
#   4. push 失败重试 3 次(每次先 rebase);冲突/被拒 → 停下 + 企业微信通知,绝不 force
#   5. 每轮开始/结束各写一次心跳(字段见 note-sync-lib.sh 头部契约);
#      拉取连续失败、真冲突、上游未设置都会写进心跳并在告警里给出错误首行
#
# 配置:~/.note-sync/config.env(机器私有,不入库)
#   NOTE_DIR=/f/0-Note
#   HAC_DIR=/c/Users/23652/home-automation-configs
#   NOTE_SYNC_QUIET_MIN=1                            # 可选,静默窗(分钟),默认 1
#   WECOM_WEBHOOK_FILE=~/.note-sync/wecom-blog.txt   # 可选,失败时通知用(内容仓群;
#                                                    #  2026-10-12 起不再走服务器告警群)
# 公共层(配置/日志/通知/锁/心跳/限流/推送前闸门):scripts/note-sync/note-sync-lib.sh
# Windows 侧:任务定义与注册脚本在 ~/.note-sync/windows-tasks/*.xml 与
#   ~/.note-sync/install-windows-tasks.ps1(机器私有,不入库);旧任务备份在
#   ~/.note-sync/schedule-backup/NoteSync.xml。
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./note-sync-lib.sh
. "$SELF_DIR/note-sync-lib.sh"

cd "$NOTE_DIR" 2>/dev/null || { log "找不到 $NOTE_DIR"; exit 2; }
git rev-parse --git-dir >/dev/null 2>&1 || { log "$NOTE_DIR 不是 git 仓库"; exit 2; }

# ── 0. 锁 + 心跳 ─────────────────────────────────────────────────
if ! acquire_lock; then exit 0; fi
HEARTBEAT_NOTE="本轮开始"
HEARTBEAT_OK=true
write_heartbeat "$HEARTBEAT_NOTE" true

# 结束心跳走 EXIT trap:所有 exit 路径(含意外中断)都会留一条,并释放锁。
finish() {
    write_heartbeat "${HEARTBEAT_NOTE:-本轮结束}" "${HEARTBEAT_OK:-false}"
    release_lock
}
trap finish EXIT

# ── 1. 拉取(远端为主)────────────────────────────────────────────
move_conflicting_untracked

if ! out=$(timeout -k 5 "${NET_TIMEOUT:-150}" git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 pull --rebase --autostash 2>&1); then
    # **区分「真冲突」与「链路不通」** —— 两者处置完全不同,混报会把人叫去解一个不存在的冲突。
    # 2026-10-09 实测:服务器到 github 的连接时断时续(15s 超时),而这里一律报
    # 「请你手动解决冲突后提交」;实际工作树干净、没有 rebase 在进行,根本无冲突可解。
    # 原因一律取错误输出的**首行**:git 的首行是人话(第二行起常是文件列表 / 进度噪声),
    # 原先非冲突分支贴「网络」标签再把真因裁成末行,等于把真因藏了。
    reason=$(printf '%s' "$out" | head -n 1 | cut -c1-200)
    if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] \
       || [ -n "$(git diff --name-only --diff-filter=U 2>/dev/null)" ]; then
        # 真冲突:abort 会把本地提交丢掉,所以**先打包存证**再 abort,绝不自动选边。
        mkdir -p "$STATE_DIR/conflicts"
        bundle="$STATE_DIR/conflicts/$(date +%Y%m%d-%H%M%S).bundle"
        bundle_args=(HEAD)
        git rev-parse -q --verify refs/remotes/origin/master >/dev/null 2>&1 \
            && bundle_args+=(--not refs/remotes/origin/master)
        if ! git bundle create "$bundle" "${bundle_args[@]}" >>"$LOG" 2>&1; then
            log "bundle 生成失败(见上一行输出)"
            bundle="$bundle(生成失败)"
        fi
        git rebase --abort >/dev/null 2>&1 || true
        log "pull 冲突:$reason;存证 $(winpath "$bundle")"
        HEARTBEAT_NOTE="真冲突,已存证并 abort:${reason}"
        HEARTBEAT_OK=false
        notify_throttled pull-conflict "内容仓 同步 · 有真冲突要处理
请你:在 ${NOTE_LABEL} 里手动解决冲突后提交;想找回本机被 abort 掉的提交:
  git fetch $(winpath "$bundle") HEAD:rescued
原因:git pull --rebase 因冲突停下(有未合并的路径)
存证:$(winpath "$bundle")
不处理的后果:本机与远端会继续分叉,后面每次同步都会停"
    else
        # 连续失败计数:单次抖动不值得打扰,连着 3 轮才发一次告警(同类 30 分钟限流)。
        n=$(cat "$PULL_FAIL_FILE" 2>/dev/null || echo 0)
        case "$n" in ''|*[!0-9]*) n=0 ;; esac
        n=$((n + 1))
        printf '%s\n' "$n" >"$PULL_FAIL_FILE"
        log "pull 失败(非冲突,连续 ${n} 次):$reason"
        HEARTBEAT_NOTE="拉取失败(连续 ${n} 次):${reason}"
        HEARTBEAT_OK=false
        if [ "$n" -ge 3 ]; then
            notify_throttled pull-fail "内容仓 同步 · 连续 ${n} 次拉取失败
请你:在本机查一下到 GitHub 的链路(网络 / 代理 / DNS),细节见 $LOG 最近几行
原因:${reason}
不处理的后果:本机拉不到远端新内容,会一直停在旧版本"
        fi
    fi
    exit 1
fi
rm -f "$PULL_FAIL_FILE"
[ "$out" != "Already up to date." ] && log "pull:$out"

# ── 2. 挑出"已稳定"的改动(QUIET_MIN 分钟没被改过)──────────────
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
    # 没有新改动;若本地有未推送提交(别的会话提交过)也要推。
    # @{u} 不存在时**不能**判成「无待推送」——那样本地提交永远发不出去也没人知道
    # (2026-10-14 修:`git log '@{u}..HEAD'` 报错被 2>/dev/null 吞掉,wc 得到 0)。
    if git rev-parse -q --verify '@{u}' >/dev/null 2>&1; then
        pending=$(git log --oneline '@{u}..HEAD' 2>/dev/null | wc -l)
    else
        log "@{u} 不存在,无法判断哪些提交待推送"
        HEARTBEAT_NOTE="本地有提交但上游未设置(@{u} 不存在)"
        HEARTBEAT_OK=false
        notify_throttled upstream-missing "内容仓 同步 · 本地有提交但上游未设置
请你:在 ${NOTE_LABEL} 跑 git branch -vv 看当前分支的 upstream,必要时
  git push -u origin $(git rev-parse --abbrev-ref HEAD)
原因:@{u} 不存在,脚本无法判断哪些提交待推送(旧版本把这种情况误判成「无改动、无待推送」)
不处理的后果:本地提交永远上不了云,服务器与博客都拉不到"
        exit 1
    fi
    if [ "${pending:-0}" -eq 0 ]; then
        log "无改动、无待推送"
        HEARTBEAT_NOTE="无改动、无待推送"
        blog_guard          # 兜底:每 30 分钟比一次(note HEAD vs 博客最近成功部署)+ 失败自愈
        exit 0
    fi
else
    git add -- "${READY[@]}" || { log "git add 失败"; exit 1; }
    log "暂存 ${#READY[@]} 个文件:${READY[*]}"
fi

# ── 3. 脱敏闸门(仓库是 public)────────────────────────────────────
if ! gate_privacy; then
    git reset -q -- "${READY[@]}" >/dev/null 2>&1 || true   # 只撤回本次暂存的路径,别动别的会话已暂存的内容
    HEARTBEAT_NOTE="脱敏闸门拦下(未推送)"
    HEARTBEAT_OK=false
    notify_throttled gate-privacy "内容仓 同步 · 需要你处理
请你:看本机 $LOG 的最近几行,删掉凭据或把文件加进 .gitignore
原因:push 前脱敏检查命中(个人标识或明文账号密码形状)
命中:
${GATE_HITS}
不处理的后果:这次不会推送 —— 仓库是公开的,推上去等于永久公开"
    exit 1
fi

# ── 3b. 巡检闸门(内容仓自己的规则:课件规范 / 断链 / 索引登记)────
if ! gate_vault; then
    git reset -q -- "${READY[@]}" >/dev/null 2>&1 || true   # 只撤回本次暂存的路径
    HEARTBEAT_NOTE="巡检闸门拦下(未推送)"
    HEARTBEAT_OK=false
    notify_throttled gate-vault "内容仓 同步 · 需要你处理
请你:在 ${NOTE_LABEL} 里跑 python3 -B ${VAULT_CHECK_REL} --fail-on ${VAULT_GATE_STAGES_USED}
原因:推送前巡检未通过(课件规范 / 断链 / 索引登记这类硬规则)
命中:
${GATE_HITS}
不处理的后果:这次不会推送 —— 先按报告改掉,或临时把该阶段从 VAULT_GATE_STAGES 里去掉"
    exit 1
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
        HEARTBEAT_NOTE="推送成功(第 $attempt 次)"
        HEARTBEAT_OK=true
        rm -f "$PULL_FAIL_FILE"                                        # 网络恢复:清掉拉取失败计数
        blog_guard --force --reason "note-sync 推送成功(第 $attempt 次)"   # 内容刚变:立即通知博客重建
        exit 0
    fi
    log "push 第 $attempt 次失败:$out"
    timeout -k 5 "${NET_TIMEOUT:-150}" git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 pull --rebase --autostash >/dev/null 2>&1 || { git rebase --abort >/dev/null 2>&1 || true; break; }
    sleep 3
done

last_reason=$(printf '%s' "$out" | head -n 1 | cut -c1-200)
HEARTBEAT_NOTE="推送连续失败:${last_reason}"
HEARTBEAT_OK=false
notify_throttled push-fail "内容仓 同步 · 需要你处理
请你:在 ${NOTE_LABEL} 跑一次 git push 看报错
原因:自动推送连续 3 次失败,最后一次:${last_reason}
不处理的后果:本机改动还没上云,服务器也就拉不到"
exit 1
