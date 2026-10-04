#!/usr/bin/env bash
#
# sync-microsoft-rewards.sh —— 把本机开发克隆(默认 %REWARDS_DIR%)的已跟踪文件同步成
# 本仓库 proj-microsoft-rewards/ 下的快照。
#
# 源仓库是上游 TheNetsky/Microsoft-Rewards-Script v4.3.2 的本地改造:只有 upstream 远端,
# 没有自己的 origin。本脚本承担「push」的角色 —— 在 %REWARDS_DIR% 提交后跑一次,把结果
# 发布到本仓库再提交。git 不能把 origin 指到另一个仓库的子目录,这就是替代方案。
#
# 规则:
#   * 只发布源仓库 `git ls-files` 的已跟踪文件,外加 EXTRA 里明确列出的个别未跟踪文件。
#     凭据(.env)、运行数据(sessions/ logs/ data/ dist/ node_modules/)一概不进快照。
#   * KEEP 是本目录自己维护、不参与同步的文件;SKIP 是源仓库里不发布的路径。
#   * 发布前统一去本机化与脱敏:本机绝对路径 -> %REWARDS_DIR%;旧仓库引用 -> docs/;
#     个人标识(取自机器私有 sensitive-patterns.txt)-> sample。缺该文件直接报错退出,
#     因为源仓库的测试夹具含真实账号,宁可不同步也不能误发。
#   * 源仓库的 patches/ 不进快照 —— 补丁由合集层 ../patches/microsoft-rewards/ 统一存档。
#   * 源仓库的 README.md 发布为 README.upstream.md(本目录自己的 README.md 由人维护)。
#
# 用法:bash scripts/sync-microsoft-rewards.sh [--dry-run]
# 源目录:环境变量 REWARDS_DIR,或机器私有文件
#         ~/.config/automation-suite/local-paths.env(不进仓库)
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEST="$REPO_DIR/proj-microsoft-rewards"

LOCAL_PATHS_FILE="${AUTOMATION_LOCAL_PATHS:-$HOME/.config/automation-suite/local-paths.env}"
if [[ -f "$LOCAL_PATHS_FILE" ]]; then
  # shellcheck source=/dev/null
  . "$LOCAL_PATHS_FILE"
fi
SOURCE="${REWARDS_DIR:-/e/Microsoft-Rewards-Script-4.3.2}"
SENSITIVE_FILE="${SENSITIVE_PATTERNS_FILE:-$HOME/.config/automation-suite/sensitive-patterns.txt}"

# 本目录自维护、不写不删
KEEP=(README.md SNAPSHOT.txt QUICKSTART.md)
# 源仓库里不发布的路径前缀(第二个文件名里的 $t 是文件名的字面部分,不是变量)
# shellcheck disable=SC2016
SKIP=('patches/' 'scripts/windows/_t_logs$t.log')
# 源仓库未跟踪、但要发布的少量文件
EXTRA=(config.json)
# 源路径 -> 快照路径
RENAMES=('README.md:README.upstream.md')

DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -h | --help) sed -n '2,24p' "$0"; exit 0 ;;
    *) printf '未知参数:%s\n' "$arg" >&2; exit 2 ;;
  esac
done

[[ -d "$SOURCE/.git" ]] || {
  printf '源头不是 git 仓库:%s\n用 REWARDS_DIR 指定,或写进 %s\n' "$SOURCE" "$LOCAL_PATHS_FILE" >&2
  exit 1
}
[[ -f "$SENSITIVE_FILE" ]] || {
  printf '缺少个人标识清单:%s\n' "$SENSITIVE_FILE" >&2
  printf '本项目的测试夹具含真实账号,先建该文件(一行一个标识)再同步。\n' >&2
  printf '模板:scripts/sensitive-patterns.txt.example(复制到上面那个路径并填自己的标识)。\n' >&2
  printf '宁可不同步也不误发 —— 这道防线不允许跳过。\n' >&2
  exit 1
}

dest_rel() {
  local f="$1" r
  for r in "${RENAMES[@]}"; do
    [[ "${r%%:*}" == "$f" ]] && { printf '%s' "${r#*:}"; return; }
  done
  printf '%s' "$f"
}

is_skipped() {
  local f="$1" s
  for s in "${SKIP[@]}"; do [[ "$f" == "$s"* ]] && return 0; done
  return 1
}

is_kept() {
  local f="$1" k
  for k in "${KEEP[@]}"; do [[ "$f" == "$k" ]] && return 0; done
  return 1
}

# 把 sed BRE 的元字符转义(只覆盖标识符/邮箱里会出现的字符)
esc() { printf '%s' "$1" | sed -e 's/[.[\*^$|&\\]/\\&/g'; }

# 去本机化(固定)+ 脱敏(来自机器私有清单);顺序:先固定,再逐个标识
SED_ARGS=(
  -e 's|E:.Microsoft-Rewards-Script-4\.3\.2|%REWARDS_DIR%|g'
  -e 's|automation-suite/docs/|docs/|g'
)
PATTERNS=()
while IFS= read -r pat; do
  pat="${pat%$'\r'}"
  [[ -z "${pat//[[:space:]]/}" || "$pat" == \#* ]] && continue
  PATTERNS+=("$pat")
  SED_ARGS+=(-e "s|$(esc "$pat")|sample|g")
done < "$SENSITIVE_FILE"

# 自检:每个标识单独过一遍规则,必须正好变成 sample,否则中止(防转义 bug 误发)
for pat in "${PATTERNS[@]}"; do
  [[ "$(printf '%s' "$pat" | sed "${SED_ARGS[@]}")" == "sample" ]] || {
    printf '脱敏规则自检失败,拒绝同步:%s\n' "$pat" >&2
    exit 1
  }
done

emit() { sed "${SED_ARGS[@]}" < "$SOURCE/$1"; }

dirty=$(git -C "$SOURCE" status --porcelain --untracked-files=no)
[[ -z "$dirty" ]] || printf '警告:%s 有未提交的已跟踪改动,快照会包含工作区内容\n' "$SOURCE" >&2

mapfile -d '' -t src_files < <(git -C "$SOURCE" ls-files -z)
declare -A want=()
pub=()
for f in "${src_files[@]}"; do
  is_skipped "$f" && continue
  d=$(dest_rel "$f")
  want["$d"]=1
  pub+=("$d|$f")
done
for f in "${EXTRA[@]}"; do
  if [[ -e "$SOURCE/$f" ]]; then
    want["$f"]=1
    pub+=("$f|$f")
  else
    printf '警告:EXTRA 文件在源仓库不存在,跳过:%s\n' "$f" >&2
  fi
done

changed=0
for entry in "${pub[@]}"; do
  d="${entry%%|*}"
  s="${entry#*|}"
  if ((DRY)); then
    cmp -s <(emit "$s") "$DEST/$d" 2>/dev/null || { printf '更新  %s\n' "$d"; changed=$((changed + 1)); }
  else
    mkdir -p "$DEST/$(dirname "$d")"
    emit "$s" > "$DEST/$d"
  fi
done

while IFS= read -r -d '' path; do
  rel="${path#"$DEST"/}"
  [[ -n "${want[$rel]:-}" ]] && continue
  is_kept "$rel" && continue
  if ((DRY)); then printf '删除  %s\n' "$rel"; changed=$((changed + 1)); else rm -f "$path"; fi
done < <(find "$DEST" \( -name .git -o -name node_modules -o -name data -o -name sessions -o -name logs \) -prune -o -type f -print0 2>/dev/null)

if ((DRY)); then
  printf 'dry-run:共 %s 处差异(README/SNAPSHOT 由本目录自维护)\n' "$changed"
  exit 0
fi

find "$DEST" -mindepth 1 -type d -empty -delete 2>/dev/null || true

# 防线:发布结果里再扫一遍个人标识,命中即报错(只扫本次发布的文件,KEEP 不含)
pub_paths=()
for entry in "${pub[@]}"; do pub_paths+=("$DEST/${entry%%|*}"); done
hits=()
for pat in "${PATTERNS[@]}"; do
  while IFS= read -r hit; do hits+=("$hit"); done < <(grep -l -F -- "$pat" "${pub_paths[@]}" 2>/dev/null || true)
done
if ((${#hits[@]})); then
  printf '错误:发布结果里仍出现个人标识,已中止复核:\n' >&2
  printf '  %s\n' "${hits[@]}" >&2
  exit 1
fi

{
  printf 'source: local development clone %%REWARDS_DIR%%, tracked files only\n'
  printf 'published in: Zzz210s/scripts-hub -> proj-microsoft-rewards/\n'
  printf 'source commit: %s\n' "$(git -C "$SOURCE" rev-parse HEAD)"
  printf 'source commit date: %s\n' "$(git -C "$SOURCE" log -1 --format=%cI)"
  printf 'published file count: %s\n' "${#pub[@]}"
  printf 'extra (untracked in source): %s\n' "${EXTRA[*]}"
  # shellcheck disable=SC2016
  printf 'excluded: %s\n' 'patches/ (canonical at ../patches/microsoft-rewards/), scripts/windows/_t_logs$t.log'
  printf 'renamed: %s\n' 'README.md -> README.upstream.md'
  printf 'rewritten: local absolute paths -> %%REWARDS_DIR%%; automation-suite/docs/ -> docs/\n'
  printf 'redacted: %s personal identifiers from the machine-private list -> sample\n' "${#PATTERNS[@]}"
  printf 'synced at: %s\n' "$(date -Iseconds 2>/dev/null || date)"
} > "$DEST/SNAPSHOT.txt"

printf '同步完成:%s -> %s(%s 个文件)\n' "$SOURCE" "$DEST" "${#pub[@]}"
printf '记得 git add proj-microsoft-rewards && git status 复核。\n'
