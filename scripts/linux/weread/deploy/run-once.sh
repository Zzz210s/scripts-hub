#!/usr/bin/env bash
# 容器内一次性运行:跑一次微信读书签到(守卫、通知、状态都由程序自己管)
set -euo pipefail

cd /opt/weread
echo "[run-once] $(date -Is) start"
exec node src/index.js run
