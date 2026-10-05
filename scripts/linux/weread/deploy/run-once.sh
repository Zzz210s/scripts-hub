#!/usr/bin/env bash
# 容器内一次性运行:跑一次微信读书签到(守卫、通知、状态都由程序自己管)
set -euo pipefail

cd /opt/weread

# config.yaml 从宿主只读挂进来当"模板",这里复制到容器可写层再用。
# 为什么必须复制:程序每次运行会改它(写入本次的目标时长与账号名),写法是
# 「写 .tmp 再 rename 覆盖」。而宿主上以**文件**形式 bind mount 进来的路径是挂载点,
# rename 覆盖挂载点会报 EBUSY: resource busy or locked(2026-10-05 实测:当天第一次
# 真跑就卡在这里,退出码 1、一条消息都没发)。
TEMPLATE=/opt/weread/config.template.yaml
if [ ! -f "$TEMPLATE" ]; then
    echo "[run-once] ERROR: 缺少 $TEMPLATE(compose 里应把宿主的 config.yaml 挂成这个名字)" >&2
    exit 2
fi
cp -f "$TEMPLATE" /opt/weread/config.yaml

echo "[run-once] $(date -Is) start"
exec node src/index.js run
