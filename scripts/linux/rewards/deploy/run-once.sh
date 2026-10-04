#!/usr/bin/env bash
# 容器内一次性运行:准备配置 → 跑一遍全部账号 → 退出(不启动 cron)
#
# 这是上游 entrypoint.sh 的"跑一次"精简版:保留它做的配置准备(ConfigSync 补齐缺失项、
# 应用 CONFIG_* 覆盖、把 config/config.json 链回项目根),去掉 cron 与常驻进程。
# 单实例与随机等待交给上游的 scripts/docker/run_daily.sh(SKIP_RANDOM_SLEEP=true 跳过随机等)。
set -euo pipefail

export PLAYWRIGHT_BROWSERS_PATH=0
cd /usr/src/microsoft-rewards-script

CONFIG=config/config.json
if [ ! -f config.example.json ]; then
    echo "[run-once] ERROR: config.example.json missing in image" >&2
    exit 1
fi
if [ -d "$CONFIG" ]; then
    echo "[run-once] ERROR: $CONFIG is a directory - 宿主上先创建 config/config.json" >&2
    exit 1
fi
if [ ! -f "$CONFIG" ]; then
    cp config.example.json "$CONFIG"
fi

node dist/util/ConfigSync.js sync --config "$CONFIG" --example config.example.json
node dist/util/ConfigEnvOverrides.js apply --config "$CONFIG"
ln -sf "$PWD/$CONFIG" config.json

echo "[run-once] $(date -Is) start, clusters=$(node -e "process.stdout.write(String(require('./config.json').clusters))")"

SKIP_RANDOM_SLEEP=true scripts/docker/run_daily.sh
