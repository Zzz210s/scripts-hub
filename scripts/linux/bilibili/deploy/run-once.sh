#!/usr/bin/env bash
# 容器内一次性运行:cookies.json 复制进/出 + 跑一次薄壳。
#
# 为什么复制而不是 bind mount 单文件:Console 用 tmp + rename 写 cookies.json,
# 单文件 bind mount 在 rename 覆盖时会 EBUSY(既有项目 2026-10-05 踩过)。
# Console 只在它的 cwd(ContentRoot,/app)认这个文件,所以进出都走 /app/cookies.json。
set -euo pipefail

cd /opt/bili
if [ -f /opt/bili/secrets/cookies.json ]; then
    cp /opt/bili/secrets/cookies.json /app/cookies.json
fi

echo "[run-once] $(date -Is) start"
code=0
node src/cli.js run || code=$?

if [ -f /app/cookies.json ]; then
    cmp -s /app/cookies.json /opt/bili/secrets/cookies.json || cp /app/cookies.json /opt/bili/secrets/cookies.json
fi
exit "$code"
