#!/usr/bin/env bash
#
# sync-weread-signin.sh:把权威仓库(默认本地克隆 %WEREAD_DIR%)的已跟踪文件同步成
# 本仓库 weread-signin/ 下的快照。
#
# 只同步 `git ls-files` 列出的文件:凭据、运行数据、vendor/ 等未跟踪内容一概不进快照。
# 本目录里手写的文件(见 KEEP)不会被动;其余非源文件会被清掉,保证快照 == 源仓库。
# README 顶部每次都重写一遍快照说明。
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

# 本仓库自己维护、不参与同步的文件
KEEP=(LOCAL-DEPLOYMENT.md SNAPSHOT.txt)

DRY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) printf '未知参数:%s\n' "$arg" >&2; exit 2 ;;
  esac
done

banner_en() {
  cat <<'EOF'
> **Snapshot, not the source of truth.** This directory is a copy of the tracked
> files of the authoritative repository
> [`Zzz210s/weread-signin`](https://github.com/Zzz210s/weread-signin) (archived,
> read-only), whose local development clone is `%WEREAD_DIR%`. The commit it was
> taken from is recorded in `SNAPSHOT.txt`. Do not edit files here: run
> `scripts/sync-weread-signin.sh` to refresh them from the authoritative clone.
> `LOCAL-DEPLOYMENT.md` is hand-written and exempt from the sync. The files in
> this directory are MIT-licensed (see `LICENSE`); the rest of this repository
> is GPL-3.0.

EOF
}

banner_zh() {
  cat <<'EOF'
> **快照,不是开发来源。** 本目录是权威仓库
> [`Zzz210s/weread-signin`](https://github.com/Zzz210s/weread-signin)(已归档只读)已跟踪文件的副本,
> 其本地开发克隆在 `%WEREAD_DIR%`;取快照时的提交记录在 `SNAPSHOT.txt`。
> 不要直接改这里的文件 —— 跑 `scripts/sync-weread-signin.sh` 从权威克隆刷新;
> 本目录手写的 `LOCAL-DEPLOYMENT.md` 不参与同步。本目录文件为 MIT 许可(见 `LICENSE`),
> 本仓库其余部分为 GPL-3.0。

EOF
}

# emit <相对路径>:打印该文件期望写进快照的完整内容(README 先加快照说明)。
emit() {
  local rel="$1"
  case "$rel" in
    README.md) banner_en ;;
    README.zh-CN.md) banner_zh ;;
    test/*.js)
      # 源仓库(公开)的测试夹具里写死了本机盘符(如 `X:/...`),快照里换成中性路径,
      # 避免公开仓出现个人盘符;夹具与断言一起改,测试仍全绿(215 项)。
      # 只认“行首或非字母数字后跟盘符:/”的形状,不会误伤 https:// 里的 s:/。
      sed -E 's@(^|[^A-Za-z0-9])[A-Za-z]:/tmp/@\1/tmp/@g; s@(^|[^A-Za-z0-9])[A-Za-z]:/@\1/tmp/@g' "$SOURCE/$rel"
      return ;;
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
for f in "${src_files[@]}"; do want["$f"]=1; done

changed=0
for f in "${src_files[@]}"; do
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
  printf 'source repository: Zzz210s/weread-signin (https://github.com/Zzz210s/weread-signin)\n'
  printf 'source commit: %s\n' "$(git -C "$SOURCE" rev-parse HEAD)"
  printf 'source commit date: %s\n' "$(git -C "$SOURCE" log -1 --format=%cI)"
  printf 'synced file count: %s\n' "${#src_files[@]}"
  printf 'notes: test/*.js 里写死的本机盘符已替换为 /tmp/(源仓库是公开仓,避免快照带个人盘符)\n'
  printf 'synced at: %s\n' "$(date -Iseconds 2>/dev/null || date)"
} > "$DEST/SNAPSHOT.txt"

printf '同步完成:%s -> %s(%s 个文件)\n' "$SOURCE" "$DEST" "${#src_files[@]}"
printf '记得 git add weread-signin && git status 复核。\n'
