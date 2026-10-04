#!/usr/bin/env bash
#
# deploy-weread-signin:把仓库 proj-weread-signin/ 的快照刷进本机工作区,并体检本机部署。
# 默认 --dry-run(只报告差异与缺项,不写任何文件);--apply 才写入。
# 不碰计划任务 —— 只检查 WeReadSignIn 是否存在、触发器是否符合约定;缺了给出注册命令。
#
# 用法:bash scripts/deploy-weread-signin.sh [--dry-run|--apply] [--dest=<目录>] [--force]
#   --dest=<目录>  写到别处(验证用临时目录);默认写回权威工作区 %WEREAD_DIR%
#   --apply 写文件;工作区 HEAD 与快照源提交不一致时拒绝覆盖,--force 可跳过
# 退出码:--dry-run 恒为 0;--apply 有阻塞项时为 1。“缺什么”都以 [缺] 行给出下一步。
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SNAP_REL=proj-weread-signin
SNAP="$REPO_DIR/$SNAP_REL"
VENDOR_COMMIT=0cc9b5c309d1ede76b60f7fd453f6eb403b6307b
TASK_NAME=WeReadSignIn

LOCAL_PATHS_FILE="${AUTOMATION_LOCAL_PATHS:-$HOME/.config/automation-suite/local-paths.env}"
SENSITIVE_FILE="${SENSITIVE_PATTERNS_FILE:-$HOME/.config/automation-suite/sensitive-patterns.txt}"
if [[ -f "$LOCAL_PATHS_FILE" ]]; then
  # shellcheck source=/dev/null
  . "$LOCAL_PATHS_FILE"
fi
SOURCE="${WEREAD_SIGNIN_DIR:-$HOME/weread-signin}"

# 合集层维护、不部署的文件(不是源仓库里的文件)
KEEP=(SNAPSHOT.txt QUICKSTART.md)

APPLY=0
FORCE=0
DEST=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --force) FORCE=1 ;;
    --dest=*) DEST="${arg#*=}" ;;
    -h | --help) sed -n '2,10p' "$0"; exit 0 ;;
    *) printf '未知参数:%s\n' "$arg" >&2; exit 2 ;;
  esac
done
TARGET="${DEST:-$SOURCE}"

BLOCK=0
ok() { printf '[通过] %s\n' "$*"; }
info() { printf '[提示] %s\n' "$*"; }
miss() { printf '[缺]   %s\n' "$*"; }
bad() {
  printf '[阻塞] %s\n' "$*"
  BLOCK=1
}
step() { printf '\n== %s ==\n' "$*"; }
in_list() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do [[ "$item" == "$needle" ]] && return 0; done
  return 1
}

# "Ready MSFT_TaskLogonTrigger,MSFT_TaskDailyTrigger" 或空(不存在/不可查)
task_line() {
  command -v powershell.exe >/dev/null 2>&1 || return 1
  powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; \$t=Get-ScheduledTask -TaskName '$1' -ErrorAction SilentlyContinue; if(-not \$t){exit 3}; \$tr=(\$t.Triggers|ForEach-Object{\$_.CimClass.CimClassName}) -join ','; Write-Output (\$t.State.ToString()+' '+\$tr)" 2>/dev/null
}

printf '== 部署 %s 到 %s(%s)==\n' "$SNAP_REL" "$TARGET" "$([[ $APPLY == 1 ]] && echo apply || echo dry-run)"
[[ -d "$SNAP" ]] || {
  printf '[阻塞] 仓库里没有 %s\n' "$SNAP_REL" >&2
  exit 1
}

step '1/6 路径与本机私有配置'
info "仓库快照:$SNAP"
info "权威工作区:$SOURCE(来源:$([[ -f "$LOCAL_PATHS_FILE" ]] && echo "$LOCAL_PATHS_FILE" || echo '默认值'))"
if [[ -f "$LOCAL_PATHS_FILE" ]]; then
  ok "私有路径文件存在:$LOCAL_PATHS_FILE"
else
  miss "缺 $LOCAL_PATHS_FILE —— 复制 scripts/local-paths.env.example 到该位置并填本机路径"
fi
if [[ -f "$SENSITIVE_FILE" ]]; then
  ok "个人标识清单存在:$SENSITIVE_FILE"
else
  miss "缺 $SENSITIVE_FILE —— 复制 scripts/sensitive-patterns.txt.example 并填自己的标识(供 check-privacy 用)"
fi

step '2/6 目标工作区'
if [[ -d "$TARGET" ]]; then
  ok "目标目录存在"
elif ((APPLY)); then
  if mkdir -p "$TARGET"; then ok '已创建目标目录'; else bad "建不了目标目录:$TARGET"; fi
else
  info "目标目录不存在,apply 时会创建"
fi
if [[ -d "$TARGET/.git" ]]; then
  ok '目标是一个 git 仓库'
  snap_commit=$(sed -n 's/^source commit: //p' "$SNAP/SNAPSHOT.txt" 2>/dev/null | head -1)
  have_commit=$(git -C "$TARGET" rev-parse HEAD 2>/dev/null || echo '')
  if [[ -n "$snap_commit" && -n "$have_commit" && "$snap_commit" != "$have_commit" ]]; then
    miss "工作区 HEAD($have_commit) 与快照源提交($snap_commit)不一致 —— 先用 scripts/sync-weread-signin.sh 同步;确要用快照覆盖工作区加 --force"
    if ((APPLY)) && ((!FORCE)); then bad '拒绝覆盖:工作区比快照新,先同步再部署(--force 可跳过)'; fi
  fi
else
  info '目标不是 git 仓库(工作区可以是普通目录;从上游装的本体通常带 .git)'
fi

step '3/6 刷新快照文件'
changed=0
added=0
same=0
total=0
mapfile -t files < <(git -C "$REPO_DIR" ls-files -- "$SNAP_REL" | sed "s|^$SNAP_REL/||")
for rel in "${files[@]}"; do
  in_list "$rel" "${KEEP[@]}" && continue
  total=$((total + 1))
  src="$SNAP/$rel"
  dst="$TARGET/$rel"
  if [[ ! -e "$dst" ]]; then
    added=$((added + 1))
    printf '  新增  %s\n' "$rel"
  elif cmp -s "$src" "$dst"; then
    same=$((same + 1))
    continue
  else
    changed=$((changed + 1))
    printf '  更新  %s\n' "$rel"
  fi
  if ((APPLY)); then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  fi
done
info "共 $total 个文件:未变 $same,更新 $changed,新增 $added"
if ((APPLY)); then info '已写入目标'; else info 'dry-run 未写任何文件'; fi

step '4/6 凭据与配置'
for f in read-request.curl weread-api-key.txt; do
  if [[ -s "$TARGET/secrets/$f" ]]; then
    ok "必需凭据 secrets/$f 已就位"
  else
    miss "缺必需凭据 secrets/$f —— 真跑前必填,见 proj-weread-signin/QUICKSTART.md"
  fi
done
for f in wecom-webhook.txt app-credentials.json; do
  if [[ -s "$TARGET/secrets/$f" ]]; then ok "可选凭据 secrets/$f 已就位"; else info "缺可选凭据 secrets/$f(不配则跳过对应功能)"; fi
done
if [[ -f "$TARGET/.env" ]]; then ok '.env 已就位'; else miss "缺 .env —— 复制 proj-weread-signin/.env.example 并填挑战窗口与时段"; fi
if [[ -f "$TARGET/config.yaml" ]]; then ok 'config.yaml 已就位'; else miss "缺 config.yaml —— 复制 proj-weread-signin/config.yaml.example"; fi

step '5/6 运行时与底座'
if command -v node >/dev/null 2>&1; then
  ver=$(node -p 'process.versions.node')
  if node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=11)?0:1)'; then
    ok "Node $ver(需要 >=20.11)"
  else
    bad "Node $ver 太旧,需要 >=20.11(用到 import.meta.dirname)"
  fi
else
  bad '没有 node 命令'
fi
if command -v python3 >/dev/null 2>&1; then ok "Python $(python3 -V 2>&1 | awk '{print $2}') 可用(底座需要)"; else miss '缺 python3 —— 只有底座上报层需要'; fi
if [[ -f "$TARGET/vendor/weread-bot/weread-bot.py" ]]; then
  have=$(git -C "$TARGET/vendor/weread-bot" rev-parse HEAD 2>/dev/null || echo unknown)
  if [[ "$have" == "$VENDOR_COMMIT" ]]; then ok "底座已固定到 $VENDOR_COMMIT"; else miss "底座在 $have,期望 $VENDOR_COMMIT —— 补:bash scripts/setup-weread-signin.sh --vendor"; fi
else
  miss '缺底座 vendor —— 只有真跑阅读需要;补:bash scripts/setup-weread-signin.sh --vendor'
fi

step '6/6 计划任务'
if line=$(task_line "$TASK_NAME") && [[ -n "$line" ]]; then
  state=${line%% *}
  trig=${line#* }
  ok "$TASK_NAME:$state;触发器 $trig"
  if [[ "$trig" == *LogonTrigger* && "$trig" == *DailyTrigger* ]]; then
    ok '登录触发 + 每日触发都在'
  else
    miss "触发器与约定不符(应同时有登录与每日触发)—— 重跑 $TARGET/scripts/windows/install-autostart.ps1"
  fi
else
  miss "计划任务 $TASK_NAME 不存在或查不到 —— 注册:powershell -ExecutionPolicy Bypass -File \"$TARGET/scripts/windows/install-autostart.ps1\""
fi

printf '\n结论:'
if ((APPLY)); then
  if ((BLOCK)); then
    printf '有阻塞项,见上方 [阻塞]。\n'
    exit 1
  fi
  printf '部署完成;上方 [缺] 项按提示补齐后即可真跑。\n'
else
  printf 'dry-run 结束(退出码恒 0);要写入加 --apply。\n'
fi
