#!/usr/bin/env bash
#
# deploy-weread-signin:把仓库 proj-weread-signin/ 的快照刷进本机工作区,并体检本机部署。
# 默认 --dry-run(只报告差异与缺项,不写任何文件);--apply 才写入。
# 不碰计划任务 —— 只检查 WeReadSignIn 是否存在、触发器是否符合约定;缺了给出注册命令。
#
# 快照是脱敏发布件(路径 -> 占位符、个人标识 -> sample),不能回灌权威工作区:日常刷新走
# scripts/sync-weread-signin.sh(工作区 -> 仓库);确需反向覆盖用 --allow-authoritative。
#
# 用法:bash scripts/deploy-weread-signin.sh [--dry-run|--apply] [--dest=<目录>]
#        [--allow-authoritative] [--yes] [--force]
#   --dest=<目录>  写到别处(验证用临时目录);默认写回权威工作区 %WEREAD_DIR%
#   --apply 写文件;--allow-authoritative 才允许覆盖与快照同源的工作区(会先预览、再确认、自动备份)
#   --yes 非交互环境确认覆盖(配合 --allow-authoritative);--force 是它的旧名,现等同
# 退出码:--dry-run 恒为 0;--apply 有阻塞项时为 1。“缺什么”都以 [缺] 行给出下一步。
#
# shellcheck disable=SC2034  # KEEP/PROTECT/GEN_FROM/RENAME_MAP 由 source 的 deploy-plan.sh 使用
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
PROTECT=()
declare -A GEN_FROM=()
declare -A RENAME_MAP=()

usage() { sed -n '2,16p' "$0"; }
# shellcheck source=/dev/null
. "$REPO_DIR/scripts/lib/deploy-common.sh"
# shellcheck source=/dev/null
. "$REPO_DIR/scripts/lib/deploy-plan.sh"
deploy_parse_args "$@"
TARGET="${DEST:-$SOURCE}"

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
  ok '目标目录存在'
elif ((APPLY)); then
  if mkdir -p "$TARGET"; then ok '已创建目标目录'; else bad "建不了目标目录:$TARGET"; fi
else
  info '目标目录不存在,apply 时会创建'
fi
deploy_same_source
deploy_authoritative_gate

step '3/6 刷新快照文件'
if ((SAME_SOURCE)) && ((!ALLOW_AUTH)); then
  info '跳过文件刷新:工作区与快照同源,它是权威副本;恢复时才用快照覆盖(--allow-authoritative 可强制)'
else
  deploy_plan_build
  deploy_plan_show
  deploy_authoritative_warn
  if ((APPLY)); then
    if ((SAME_SOURCE)) && ((ALLOW_AUTH)); then
      deploy_confirm || deploy_finish
    fi
    deploy_plan_apply
  else
    info 'dry-run 未写任何文件'
  fi
fi

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

step '6/6 计划任务(触发时间来自 config/schedule.json)'
if line=$(task_line "$TASK_NAME") && [[ -n "$line" ]]; then
  state=${line%% *}
  trig=${line#* }
  ok "$TASK_NAME:$state;触发器 $trig"
  if [[ "$trig" == *LogonTrigger* && "$trig" == *DailyTrigger* ]]; then
    ok '登录触发 + 每日触发都在'
  else
    miss "触发器与约定不符(应同时有登录与每日触发)—— 重跑 node scripts/apply-schedule.mjs --apply --yes"
  fi
else
  miss "计划任务 $TASK_NAME 不存在或查不到 —— 注册:node scripts/apply-schedule.mjs --dry-run 看,再 --apply --yes"
fi
deploy_check_schedule weread-signin "$TASK_NAME"

deploy_finish
