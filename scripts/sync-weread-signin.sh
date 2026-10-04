#!/usr/bin/env bash
#
# sync-weread-signin.sh:把本机开发克隆(默认 %WEREAD_DIR%)的已跟踪文件同步成
# 本仓库 weread-signin/ 下的快照 —— 那是该程序对外发布的那一份,没有独立仓库。
#
# 只同步 `git ls-files` 列出的文件:凭据、运行数据、vendor/ 等未跟踪内容一概不进快照。
# 快照目录里由本脚本生成的文件(见 KEEP)不会被动,开发克隆里机器相关的文件(见 SKIP)不发布;
# 其余非源文件会被清掉,保证快照 == 源仓库。
# README 顶部每次都重写一遍快照说明;除此之外快照与源仓库逐字节一致。
# 本机部署说明已移出快照目录(仓库里的 machine/weread-deployment.md),不再需要 KEEP 例外。
#
# 用法:bash scripts/sync-weread-signin.sh [--dry-run]
# 源目录:环境变量 WEREAD_SIGNIN_DIR,或机器私有文件
#         ~/.config/automation-suite/local-paths.env(不进仓库)
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEST="$REPO_DIR/weread-signin"

LOCAL_PATHS_FILE="${AUTOMATION_LOCAL_PATHS:-$HOME/.config/automation-suite/local-paths.env}"
if [[ -f "$LOCAL_PATHS_FILE" ]]; then
  # shellcheck source=/dev/null
  . "$LOCAL_PATHS_FILE"
fi
SOURCE="${WEREAD_SIGNIN_DIR:-$HOME/weread-signin}"

# 本脚本自己生成、不参与同步的文件
KEEP=(SNAPSHOT.txt)

# 只留在开发克隆里、不发布进快照的文件(机器相关的工作区说明)
SKIP=(WORKSPACE.md)

DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) printf '未知参数:%s\n' "$arg" >&2; exit 2 ;;
  esac
done

banner_en() {
  cat <<'EOF'
> **Generated snapshot — do not edit here.** This directory is published from the local
> development clone at `%WEREAD_DIR%` by `scripts/sync-weread-signin.sh`; the commit it
> was taken from is recorded in `SNAPSHOT.txt`. To change the code, edit and commit in
> that clone, then run the script and commit the result here. The program has no separate
> repository: this directory is its published copy. The files in this directory are
> MIT-licensed (see `LICENSE`); the rest of this repository is GPL-3.0.

EOF
}

banner_zh() {
  cat <<'EOF'
> **自动生成的快照,不要直接改这里。** 本目录由 `scripts/sync-weread-signin.sh` 从本机开发克隆
> `%WEREAD_DIR%` 发布而来;取快照时的提交记录在 `SNAPSHOT.txt`。要改代码,在那个克隆里改并提交,
> 再跑该脚本、在这里提交结果。这个程序没有独立仓库 —— 本目录就是它对外发布的那一份。
> 本目录文件为 MIT 许可(见 `LICENSE`),本仓库其余部分为 GPL-3.0。

EOF
}

# emit <相对路径>:打印该文件期望写进快照的完整内容(README 先加快照说明)。
emit() {
  local rel="$1"
  case "$rel" in
    README.md) banner_en ;;
    README.zh-CN.md) banner_zh ;;
  esac
  cat "$SOURCE/$rel"
}

[[ -d "$SOURCE/.git" ]] || {
  printf '源头不是 git 仓库:%s\n' "$SOURCE" >&2
  printf '用 WEREAD_SIGNIN_DIR 指定,或写进 %s\n' "$LOCAL_PATHS_FILE" >&2
  exit 1
}

dirty=$(git -C "$SOURCE" status --porcelain --untracked-files=no)
[[ -z "$dirty" ]] || printf '警告:%s 有未提交的已跟踪改动,快照会包含工作区内容\n' "$SOURCE" >&2

mapfile -d '' -t src_files < <(git -C "$SOURCE" ls-files -z)
declare -A want=()
pub_files=()
for f in "${src_files[@]}"; do
  want["$f"]=1
  for s in "${SKIP[@]}"; do [[ "$f" == "$s" ]] && continue 2; done
  pub_files+=("$f")
done

changed=0
for f in "${pub_files[@]}"; do
  if (( DRY )); then
    cmp -s <(emit "$f") "$DEST/$f" 2>/dev/null || { printf '更新  %s\n' "$f"; changed=$((changed + 1)); }
  else
    mkdir -p "$DEST/$(dirname "$f")"
    emit "$f" > "$DEST/$f"
  fi
done

while IFS= read -r -d '' f; do
  rel="${f#"$DEST"/}"
  [[ -n "${want[$rel]:-}" ]] && continue
  for k in "${KEEP[@]}"; do [[ "$rel" == "$k" ]] && rel="" && break; done
  [[ -n "$rel" ]] || continue
  if (( DRY )); then printf '删除  %s\n' "$rel"; changed=$((changed + 1)); else rm -f "$f"; fi
done < <(find "$DEST" -type f -print0 2>/dev/null)

if (( DRY )); then
  printf 'dry-run:共 %s 处差异(README 顶部说明每次都会重写)\n' "$changed"
  exit 0
fi

find "$DEST" -mindepth 1 -type d -empty -delete 2>/dev/null || true

{
  printf 'source: local development clone %%WEREAD_DIR%%, tracked files only\n'
  printf 'published in: Zzz210s/scripts-hub -> weread-signin/\n'
  printf 'source commit: %s\n' "$(git -C "$SOURCE" rev-parse HEAD)"
  printf 'source commit date: %s\n' "$(git -C "$SOURCE" log -1 --format=%cI)"
  printf 'synced file count: %s\n' "${#pub_files[@]}"
  printf 'notes: test/*.js 里的路径不写死盘符(用 os.tmpdir()),快照与源逐字节一致\n'
  printf 'synced at: %s\n' "$(date -Iseconds 2>/dev/null || date)"
} > "$DEST/SNAPSHOT.txt"

printf '同步完成:%s -> %s(%s 个文件)\n' "$SOURCE" "$DEST" "${#pub_files[@]}"
printf '记得 git add weread-signin && git status 复核。\n'
