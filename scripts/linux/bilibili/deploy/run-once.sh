#!/usr/bin/env bash
# 容器内入口:run-once.sh [子命令],子命令透传给 src/cli.js(不带参数 = run)。
#   docker compose -f /srv/apps/automation/compose.yaml run --rm -T bilibili-run          # 跑一次任务
#   docker compose -f /srv/apps/automation/compose.yaml run --rm -T bilibili-run login     # 扫码登录
#   docker compose -f /srv/apps/automation/compose.yaml run --rm -T bilibili-run check     # 只读体检
# 不加这个分派的话,`docker compose run <service> <命令>` 给进来的参数会被 entrypoint 吃掉 ——
# 命令传不进去,而任务照跑,扫码登录就永远做不成(2026-10-11 部署时发现 QUICKSTART 的写法有此坑)。
#
# 为什么复制而不是 bind mount 单文件:Console 用 tmp + rename 写 cookies.json,
# 单文件 bind mount 在 rename 覆盖时会 EBUSY(既有项目 2026-10-05 踩过)。
# Console 只在它的 cwd(ContentRoot,/app)认这个文件,所以进出都走 /app/cookies.json。
set -euo pipefail

CMD="${1:-run}"

cd /opt/bili
if [ -f /opt/bili/secrets/cookies.json ]; then
    cp /opt/bili/secrets/cookies.json /app/cookies.json
fi

# login 的自证要读 Console 刚写下的那个文件,所以这一次把 cookie 路径指向容器内的副本;
# 其余子命令仍以宿主侧 secrets/cookies.json 为唯一真源(D18)。
if [ "$CMD" = login ]; then
    export BILIBILI_COOKIES_FILE="${BILIBILI_COOKIES_FILE:-/app/cookies.json}"
fi

echo "[run-once] $(date -Is) cmd=$CMD start"
code=0
node src/cli.js "$CMD" || code=$?

if [ -f /app/cookies.json ]; then
    if ! cmp -s /app/cookies.json /opt/bili/secrets/cookies.json; then
        # 容器里是 root,复制出来的文件默认 644 —— 凭据文件收紧到 600
        cp /app/cookies.json /opt/bili/secrets/cookies.json
        chmod 600 /opt/bili/secrets/cookies.json
    fi
fi
exit "$code"
