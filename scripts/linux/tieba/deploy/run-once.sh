#!/usr/bin/env bash
# 容器内入口:run-once.sh [子命令...],参数透传给 src/cli.js(不带参数 = run)。
#   docker compose -f /srv/apps/automation/compose.yaml run --rm -T tieba-run            # 跑一次任务
#   docker compose -f /srv/apps/automation/compose.yaml run --rm -T tieba-run check      # 只读体检
#   docker compose -f /srv/apps/automation/compose.yaml run --rm -T tieba-run report     # 汇总当天结果
#   docker compose -f /srv/apps/automation/compose.yaml run --rm -T tieba-run run --dry  # 预览会推送什么
# 不加这个分派的话,`docker compose run <service> <命令>` 给进来的参数会被 entrypoint 吃掉。
set -euo pipefail

cd /opt/tieba
if [ "$#" -eq 0 ]; then set -- run; fi

echo "[run-once] $(date -Is) cmd=$* start"
code=0
node src/cli.js "$@" || code=$?
exit "$code"
