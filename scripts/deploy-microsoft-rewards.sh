#!/usr/bin/env bash
#
# deploy-microsoft-rewards:把仓库 proj-microsoft-rewards/ 的快照刷进本机权威工作区,并体检本机部署。
# 默认 --dry-run(只报告差异与缺项,不写任何文件);--apply 才写入。
# 不碰计划任务 —— 只检查 MicrosoftRewardsScript / AutoShutdown0200;缺了给出注册命令。
#
# 快照是脱敏发布件(路径 -> 占位符、个人标识 -> sample),不能回灌权威工作区:日常刷新走
# scripts/sync-microsoft-rewards.sh(工作区 -> 仓库);确需反向覆盖用 --allow-authoritative。
#
# 用法:bash scripts/deploy-microsoft-rewards.sh [--dry-run|--apply] [--dest=<目录>]
#        [--allow-authoritative] [--yes] [--force]
#   --dest=<目录>  写到别处(验证用临时目录);默认写回权威工作区 %REWARDS_DIR%
#   --apply 写文件;--allow-authoritative 才允许覆盖与快照同源的工作区(会先预览、再确认、自动备份)
#   --yes 非交互环境确认覆盖(配合 --allow-authoritative);--force 是它的旧名,现等同
# 退出码:--dry-run 恒为 0;--apply 有阻塞项时为 1。“缺什么”都以 [缺] 行给出下一步。
#
# shellcheck disable=SC2034  # KEEP/PROTECT/GEN_FROM/RENAME_MAP 由 source 的 deploy-plan.sh 使用
# 只回写源仓库本来就有的文件:快照里由合集层维护的 README.md / QUICKSTART.md / SNAPSHOT.txt
# 不部署;快照里的 README.upstream.md 还原成工作区的 README.md;工作区已有的 config.json
# 是机器相关配置,绝不覆盖(缺了才由 config.example.json 生成)。
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SNAP_REL=proj-microsoft-rewards
SNAP="$REPO_DIR/$SNAP_REL"

LOCAL_PATHS_FILE="${AUTOMATION_LOCAL_PATHS:-$HOME/.config/automation-suite/local-paths.env}"
SENSITIVE_FILE="${SENSITIVE_PATTERNS_FILE:-$HOME/.config/automation-suite/sensitive-patterns.txt}"
if [[ -f "$LOCAL_PATHS_FILE" ]]; then
  # shellcheck source=/dev/null
  . "$LOCAL_PATHS_FILE"
fi
SOURCE="${REWARDS_DIR:-$HOME/Microsoft-Rewards-Script-4.3.2}"

# 合集层维护、不部署的文件;部署时的改名;机器相关配置的保护与生成源
KEEP=(README.md SNAPSHOT.txt QUICKSTART.md)
PROTECT=(config.json)
declare -A GEN_FROM=([config.json]="$SNAP/config.example.json")
declare -A RENAME_MAP=([README.upstream.md]=README.md)

usage() { sed -n '2,18p' "$0"; }
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
  miss "缺 $SENSITIVE_FILE —— 复制 scripts/sensitive-patterns.txt.example 并填自己的标识(同步与隐私扫描都要它)"
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
if [[ -d "$TARGET/patches" ]]; then info '工作区 patches/ 保留(补丁不在快照里,合集层统一存档)'; fi

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
if [[ -f "$TARGET/.env" ]]; then ok '.env 已就位'; else miss '缺 .env —— 复制 proj-microsoft-rewards/env.example 并填账号'; fi
if [[ -s "$TARGET/wechat-bridge/data/wecom-webhook.txt" ]]; then
  ok '企业微信 webhook 已就位'
else
  miss '缺 wechat-bridge/data/wecom-webhook.txt —— 不配则不推送(见 docs/credentials.md)'
fi
if [[ -f "$TARGET/sessions/sessions.db" ]]; then ok '登录态 sessions/sessions.db 已就位'; else info '无登录态,首次真跑会走密码登录'; fi
if [[ -f "$TARGET/config.json" ]]; then ok 'config.json 已就位'; else miss '缺 config.json —— 由上方本脚本生成,或手动复制 config.example.json'; fi

step '5/6 运行时与构建'
if command -v node >/dev/null 2>&1; then
  ver=$(node -p 'process.versions.node')
  if node -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)'; then
    ok "Node $ver(需要 >=24)"
  else
    bad "Node $ver 太旧,上游要求 >=24"
  fi
else
  bad '没有 node 命令'
fi
if [[ -d "$HOME/AppData/Local/ms-playwright" || -d "$HOME/.cache/ms-playwright" ]]; then
  ok 'patchright/Playwright 浏览器缓存存在'
else
  miss '缺浏览器 —— 补:cd <工作区> && npx patchright install chromium'
fi
if [[ -f "$TARGET/dist/index.js" ]]; then ok 'dist/index.js 已构建'; else miss '未构建 —— 补:cd <工作区> && npm ci && npm run build'; fi
if [[ -d "$TARGET/node_modules" ]]; then
  ok 'node_modules 已就位'
else
  miss '缺 node_modules —— 补:cd <工作区> && npm ci'
fi

step '6/6 计划任务'
for pair in 'MicrosoftRewardsScript:登录触发 + 每日触发' 'AutoShutdown0200:每日 02:00 触发'; do
  name=${pair%%:*}
  want=${pair#*:}
  if line=$(task_line "$name") && [[ -n "$line" ]]; then
    ok "$name:${line%% *};触发器 ${line#* }"
  else
    miss "计划任务 $name 不存在或查不到(应:$want)—— 微软积分重跑 $TARGET/scripts/windows/install-autostart.bat;关机见同目录文档"
  fi
done

deploy_finish
