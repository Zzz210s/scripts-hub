#!/usr/bin/env bash
#
# deploy-microsoft-rewards:把仓库 proj-microsoft-rewards/ 的快照刷进本机权威工作区,并体检本机部署。
# 默认 --dry-run(只报告差异与缺项,不写任何文件);--apply 才写入。
# 不碰计划任务 —— 只检查 MicrosoftRewardsScript / AutoShutdown0200;缺了给出注册命令。
#
# 用法:bash scripts/deploy-microsoft-rewards.sh [--dry-run|--apply] [--dest=<目录>] [--force]
#   --dest=<目录>  写到别处(验证用临时目录);默认写回权威工作区 %REWARDS_DIR%
#   --apply 写文件;工作区 HEAD 与快照源提交不一致时拒绝覆盖,--force 可跳过
# 退出码:--dry-run 恒为 0;--apply 有阻塞项时为 1。“缺什么”都以 [缺] 行给出下一步。
#
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

# 合集层维护、不部署的文件;以及部署时的改名
KEEP=(README.md SNAPSHOT.txt QUICKSTART.md)
PROTECT=(config.json)

APPLY=0
FORCE=0
DEST=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --force) FORCE=1 ;;
    --dest=*) DEST="${arg#*=}" ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
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
  miss "缺 $SENSITIVE_FILE —— 复制 scripts/sensitive-patterns.txt.example 并填自己的标识(同步与隐私扫描都要它)"
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
  ok '目标是一个 git 仓库(权威工作区)'
  snap_commit=$(sed -n 's/^source commit: //p' "$SNAP/SNAPSHOT.txt" 2>/dev/null | head -1)
  have_commit=$(git -C "$TARGET" rev-parse HEAD 2>/dev/null || echo '')
  if [[ -n "$snap_commit" && -n "$have_commit" && "$snap_commit" != "$have_commit" ]]; then
    miss "工作区 HEAD($have_commit) 与快照源提交($snap_commit)不一致 —— 先用 scripts/sync-microsoft-rewards.sh 同步;确要用快照覆盖工作区加 --force"
    if ((APPLY)) && ((!FORCE)); then bad '拒绝覆盖:工作区比快照新,先同步再部署(--force 可跳过)'; fi
  fi
else
  info '目标不是 git 仓库'
fi
if [[ -d "$TARGET/patches" ]]; then info '工作区 patches/ 保留(补丁不在快照里,合集层统一存档)'; fi

step '3/6 刷新快照文件'
changed=0
added=0
same=0
total=0
mapfile -t files < <(git -C "$REPO_DIR" ls-files -- "$SNAP_REL" | sed "s|^$SNAP_REL/||")
for rel in "${files[@]}"; do
  in_list "$rel" "${KEEP[@]}" && continue
  dst_rel="$rel"
  [[ "$rel" == README.upstream.md ]] && dst_rel=README.md
  if in_list "$rel" "${PROTECT[@]}"; then
    if [[ -e "$TARGET/$dst_rel" ]]; then
      info "保留  $dst_rel(机器相关配置,不覆盖)"
    else
      total=$((total + 1))
      added=$((added + 1))
      printf '  生成  %s(由 config.example.json)\n' "$dst_rel"
      if ((APPLY)); then cp "$SNAP/config.example.json" "$TARGET/$dst_rel"; fi
    fi
    continue
  fi
  total=$((total + 1))
  src="$SNAP/$rel"
  dst="$TARGET/$dst_rel"
  if [[ ! -e "$dst" ]]; then
    added=$((added + 1))
    printf '  新增  %s\n' "$dst_rel"
  elif cmp -s "$src" "$dst"; then
    same=$((same + 1))
    continue
  else
    changed=$((changed + 1))
    printf '  更新  %s\n' "$dst_rel"
  fi
  if ((APPLY)); then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  fi
done
info "共 $total 个文件:未变 $same,更新 $changed,新增 $added"
if ((APPLY)); then info '已写入目标'; else info 'dry-run 未写任何文件'; fi

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
