#!/usr/bin/env bash
# 米游社每日签到:宿主侧一次运行。守卫、锁、通知、看门狗都在套件根目录的 run-lib.sh 里,
# 这里只声明「哪个目录、哪个服务、超时多久」。
#
# 程序本体是上游 MiyoQian 的镜像(容器里跑一轮游戏社区签到就退出),
# 配置与凭证挂在 ./miyoushe/data(容器内 /app/state);凭证由一次扫码登录写入。
set -uo pipefail
SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
set -a; [ -f "$SUITE_DIR/suite.env" ] && . "$SUITE_DIR/suite.env"; set +a   # 手工跑单个 run.sh 时也要拿到看门狗时长等参数
PROG_TITLE="米游社签到"
PROG_DIR="$SUITE_DIR/miyoushe"
PROG_SERVICE="miyoushe-run"
PROG_TIMEOUT_MIN="${MIYOUSHE_RUN_TIMEOUT_MIN:-15}"
# shellcheck source=/dev/null   # 部署后在 $SUITE_DIR 下;静态检查时不存在
. "$SUITE_DIR/run-lib.sh"
# 不带参数 = 跑一次任务;`run.sh check` 这类只读子命令会透传进容器
run_program "$@"
