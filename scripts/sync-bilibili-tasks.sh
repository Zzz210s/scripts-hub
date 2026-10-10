#!/usr/bin/env bash
#
# sync-bilibili-tasks:本项目是**校验型**同步 —— 不复制任何文件,只做自洽校验。
#
# 为什么不是真同步(设计文档 D5):proj-bilibili-tasks/ 的权威副本就在本仓库内
# (照 proj-epic-free-games 的做法),不存在"独立工作区 -> 快照"的方向,所以没有东西可同步。
# 保留这个脚本名与调用形态,只做三件可机器判定的事:
#   1) 目录必要文件存在;
#   2) VENDOR_COMMIT.txt 的 commit 与 Dockerfile 里的 ARG UPSTREAM_SHA 一致;
#   3) wecom-core 漂移检测通过(含本项目这第 4 份)。
# 将来若真拆出独立工作区,照 sync-weread-signin.sh 升级为真同步。
#
# 用法:bash scripts/sync-bilibili-tasks.sh
# 退出码:0 自洽;1 有问题(逐条打印)。
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROJ="$REPO_DIR/proj-bilibili-tasks"
DOCKERFILE="$REPO_DIR/scripts/linux/bilibili/Dockerfile"
FAILED=0
ok() { printf '[通过] %s\n' "$*"; }
bad() {
  printf '[失败] %s\n' "$*"
  FAILED=1
}

printf '== bilibili-tasks 自洽校验(校验型,不复制文件)==\n'

# 1. 必要文件
for f in package.json README.md QUICKSTART.md NOTICE LICENSE VENDOR_COMMIT.txt \
         src/cli.js src/run.js src/notify.js scripts/windows/run-daily.bat; do
  if [[ -f "$PROJ/$f" ]]; then ok "$f"; else bad "缺 $f"; fi
done
if [[ -f "$DOCKERFILE" ]]; then ok 'scripts/linux/bilibili/Dockerfile'; else bad '缺 scripts/linux/bilibili/Dockerfile'; fi

# 2. commit 三处一致:VENDOR_COMMIT.txt 与 Dockerfile 的 ARG(前 10 位)
if [[ -f "$PROJ/VENDOR_COMMIT.txt" && -f "$DOCKERFILE" ]]; then
  vendor_sha=$(head -1 "$PROJ/VENDOR_COMMIT.txt" | grep -oE '[0-9a-f]{40}' | head -1)
  docker_sha=$(grep -oE 'ARG UPSTREAM_SHA=[0-9a-f]+' "$DOCKERFILE" | head -1 | cut -d= -f2)
  if [[ -n "$vendor_sha" && -n "$docker_sha" && "${vendor_sha:0:${#docker_sha}}" == "$docker_sha" ]]; then
    ok "上游 commit 一致:${docker_sha}"
  else
    bad "上游 commit 不一致:VENDOR_COMMIT.txt=${vendor_sha:-?} Dockerfile=${docker_sha:-?}"
  fi
fi

# 3. wecom-core 漂移(含第 4 份)
if node "$REPO_DIR/scripts/check-wecom-drift.mjs" >/tmp/bilibili-drift.log 2>&1; then
  ok "$(cat /tmp/bilibili-drift.log)"
else
  bad 'wecom-core 漂移检测失败'
  cat /tmp/bilibili-drift.log
fi

printf '\n结论:'
if ((FAILED)); then
  printf '有不自洽项,见上面的 [失败]。\n'
  exit 1
fi
printf '自洽:本仓库内的副本就是权威副本,无需复制。\n'
