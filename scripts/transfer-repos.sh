#!/usr/bin/env bash
#
# transfer-repos.sh:把这套仓库从个人账号转到 GitHub 组织
# (合集模式迁移第二步;第一步是先跑 scripts/github-org-wizard.sh 建组织)
#
# 注:用户后来放弃了「按仓库合集迁到组织」的方案,改成单仓库 + 每项目一个文件夹,
# 本脚本保留作历史参考,平时不需要跑;真要跑,先把下面的 REPOS / LOCAL_DIRS 改成当时的仓库清单。
#
# 用法:
#   bash scripts/transfer-repos.sh            # dry-run,只打印将要执行的命令
#   bash scripts/transfer-repos.sh --apply    # 真的转移(会先要一次确认)
#   bash scripts/transfer-repos.sh --apply --yes   # 跳过确认(无人值守)
#
# 组织名从 ~/.config/automation-suite/org.env 的 ORG_NAME 读,缺失直接报错退出。
# 范围:三个非 fork 的仓库。Zzz210s/weread-bot 不在范围内(fork + 开放中的上游 PR #53)。
#
# 转移后仓库 URL 变成 https://github.com/<org>/<repo>;旧地址会自动 302。
# 回滚:gh api -X POST repos/<org>/<repo>/transfer -f new_owner=Zzz210s

set -euo pipefail

SOURCE_OWNER="${SOURCE_OWNER:-Zzz210s}"
ENV_FILE="${ORG_ENV_FILE:-$HOME/.config/automation-suite/org.env}"

# 机器相关路径不写死:默认读 ~/.config/automation-suite/local-paths.env(不进仓库)
LOCAL_PATHS_FILE="${AUTOMATION_LOCAL_PATHS:-$HOME/.config/automation-suite/local-paths.env}"
# shellcheck source=/dev/null
[[ -f "$LOCAL_PATHS_FILE" ]] && . "$LOCAL_PATHS_FILE"

REPOS=(weread-signin home-automation-configs)
# 本地克隆路径,只用来改 remote;目录不存在就跳过(不报错)
LOCAL_DIRS=(
  "weread-signin|${WEREAD_SIGNIN_DIR:-$HOME/weread-signin}"
  "home-automation-configs|${HOME_AUTOMATION_CONFIGS_DIR:-$HOME/home-automation-configs}"
)

APPLY=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数:$arg(可用:--apply --yes --help)" >&2; exit 2 ;;
  esac
done

info() { printf '  %s\n' "$1"; }
ok()   { printf '  [ok] %s\n' "$1"; }
warn() { printf '  [!] %s\n' "$1" >&2; }
die()  { printf '\n[停止] %s\n' "$1" >&2; shift || true; for l in "$@"; do printf '       %s\n' "$l" >&2; done; exit 1; }

# ── 1. 前置检查 ───────────────────────────────────────────────────────────
echo "== 前置检查 =="
[[ -f "$ENV_FILE" ]] || die "读不到 $ENV_FILE。" \
  "先跑 scripts/github-org-wizard.sh 建组织并写入组织名," \
  "或手工写一行 ORG_NAME=<组织名> 到这个文件。"
# shellcheck disable=SC1090  # 该文件由向导脚本生成,只有 ORG_NAME=... 这类简单赋值
source "$ENV_FILE"
[[ -n "${ORG_NAME:-}" ]] || die "$ENV_FILE 里没有 ORG_NAME。" "补一行 ORG_NAME=<组织名> 再重跑。"
command -v gh >/dev/null 2>&1 || die "没装 gh CLI。" "装好并 gh auth login 再重跑。"
gh auth status >/dev/null 2>&1 || die "gh 未登录。" "先跑 gh auth login。"
ok "组织名:$ORG_NAME(来自 $ENV_FILE)"

gh api "orgs/$ORG_NAME" --jq .login >/dev/null 2>&1 \
  || die "读不到组织 $ORG_NAME。" \
       "确认名字拼写、你是它的 owner;" \
       "若 gh 看不到组织下的仓库,去组织 Settings -> Third-party Access 放开 OAuth App,或 gh auth refresh -s read:org,repo"
ok "组织存在:$ORG_NAME"

# shellcheck disable=SC2016  # GraphQL 的 $o 由 gh 传给服务端,不能由 shell 展开
ORG_QUERY='query($o:String!){organization(login:$o){viewerCanCreateRepositories}}'
perms=$(gh api graphql -f query="$ORG_QUERY" -f o="$ORG_NAME" \
  --jq '.data.organization.viewerCanCreateRepositories' 2>/dev/null || echo "")
[[ "$perms" == "true" ]] || die "账号在 $ORG_NAME 下没有建仓库的权限(viewerCanCreateRepositories=$perms)。" \
  "转移的前提是这个权限;先在组织里把自己设为 owner。"
ok "有建仓库权限"

# 目标账号不能已有同名仓库或同一网络里的 fork
for repo in "${REPOS[@]}"; do
  if gh api "repos/$ORG_NAME/$repo" --jq .full_name >/dev/null 2>&1; then
    die "$ORG_NAME/$repo 已经存在。" "GitHub 要求目标账号下没有同名仓库(也不能是同一网络里的 fork)。"
  fi
done
ok "组织下没有同名仓库(${#REPOS[@]} 个目标仓库均可转移)"

# ── 2. 转移 ───────────────────────────────────────────────────────────────
if (( APPLY )); then
  echo
  warn "即将把以下仓库从 $SOURCE_OWNER 转到 $ORG_NAME:${REPOS[*]}"
  warn "旧 URL 会 302 到新 URL,但不要在 $SOURCE_OWNER 下重建同名仓库(重建会永久删掉跳转)。"
  if (( ! ASSUME_YES )); then
    read -r -p "  确认转移?输入 yes 继续:" reply
    [[ "$reply" == "yes" ]] || die "已取消,什么都没做。"
  fi
else
  echo
  info "dry-run:下面只打印命令,不执行(加 --apply 才会真转移)"
fi

for repo in "${REPOS[@]}"; do
  echo
  echo "== $SOURCE_OWNER/$repo =="
  info "转移命令: gh api -X POST repos/$SOURCE_OWNER/$repo/transfer -f new_owner=$ORG_NAME"

  if (( ! APPLY )); then
    for entry in "${LOCAL_DIRS[@]}"; do
      name="${entry%%|*}"; dir="${entry#*|}"
      [[ "$name" == "$repo" ]] || continue
      info "本地 remote 更新: git -C \"$dir\" remote set-url origin https://github.com/$ORG_NAME/$repo.git"
      [[ -d "$dir/.git" ]] || warn "本地目录不存在,转移时这一条会跳过:$dir"
    done
    continue
  fi

  out=$(gh api -X POST "repos/$SOURCE_OWNER/$repo/transfer" -f new_owner="$ORG_NAME" 2>&1) || die \
    "$repo 转移失败:$out" \
    "常见原因与对策:" \
    "- 权限不足:你不是源仓库 admin 或目标组织没有建仓权限" \
    "- 组织策略不允许:组织 Settings -> Repository -> Repository creation 是否允许成员建仓" \
    "- 转移冷却期 / 频率限制:等一段时间重试,或用网页 Settings -> Danger Zone -> Transfer" \
    "- gh 看不到组织仓库:组织 Settings -> Third-party Access 放开 OAuth App"
  ok "请求已受理:$out"

  # 转移是异步的,轮询确认新位置出现(最多约 60 秒)
  for i in $(seq 1 20); do
    if full=$(gh api "repos/$ORG_NAME/$repo" --jq .full_name 2>/dev/null); then
      ok "已在新位置:$full"
      break
    fi
    [[ $i -eq 20 ]] && die "$repo 请求已受理但 60 秒内没出现在 $ORG_NAME 下。" \
      "去 https://github.com/$ORG_NAME 看看是否已完成,稍后重跑本脚本复核。"
    sleep 3
  done

  topics=$(gh api "repos/$ORG_NAME/$repo/topics" --jq '.names | join(",")' 2>/dev/null || echo "")
  if [[ -n "$topics" ]]; then
    ok "topic 保留:$topics"
  else
    warn "$repo 读不到 topic;用 gh api -X PUT repos/$ORG_NAME/$repo/topics 按 docs/org-migration-audit.md 第 1 节的清单补回。"
  fi
done

# ── 3. 本地 remote ────────────────────────────────────────────────────────
echo
echo "== 本地 remote =="
for entry in "${LOCAL_DIRS[@]}"; do
  name="${entry%%|*}"; dir="${entry#*|}"
  if [[ ! -d "$dir/.git" ]]; then
    warn "跳过 $name:找不到本地仓库 $dir"
    continue
  fi
  if (( APPLY )); then
    git -C "$dir" remote set-url origin "https://github.com/$ORG_NAME/$name.git"
    ok "$name -> $(git -C "$dir" remote get-url origin)"
  else
    info "将执行: git -C \"$dir\" remote set-url origin https://github.com/$ORG_NAME/$name.git"
  fi
done

# ── 4. 收尾 ───────────────────────────────────────────────────────────────
echo
info "gh 的默认仓库上下文按当前目录推断;在本地目录里可显式固定:"
for entry in "${LOCAL_DIRS[@]}"; do
  name="${entry%%|*}"
  info "  gh repo set-default $ORG_NAME/$name"
done
info "别忘了改文档里的 6 处链接(清单见 docs/org-migration-audit.md 第 4.3 节):automation-suite/README.md 5 处 + home-automation-configs/weread-signin/README.md 1 处"
info "Zzz210s/weread-bot 不在本脚本范围内:fork + 开放中的上游 PR #53,转移风险不明,建议等 PR 结束后再决定。"
(( APPLY )) || info "本次是 dry-run,什么都没改。"
