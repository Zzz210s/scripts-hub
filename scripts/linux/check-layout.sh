#!/usr/bin/env bash
# 宿主布局体检:服务器上每个程序能不能被调度器拉起。
#
# 起因(2026-10-21):贴吧与网易云的 `<程序>/run.sh` 部署时漏铺,run-all.sh 调它必然
# 退出码 127(命令不存在),而 suite.log 里只有一行「退出码 127」,看起来像程序自身故障。
# 这个脚本只查「一定会让调度失败」的硬条件,其余按提示列出、不算失败 ——
# 各程序的目录形状本来就不一样(微软积分的数据在 sessions/,别的是 data/),用统一清单硬查会误报,
# 而一个会误报的体检脚本等于没有。
#
# 用法:
#   scripts/linux/check-layout.sh                 # 默认检查 /srv/apps/automation
#   SUITE_DIR=/tmp/fake scripts/linux/check-layout.sh
# 退出码:0 硬条件全过;1 有硬缺陷(逐条列出)。
set -uo pipefail

SUITE_DIR="${SUITE_DIR:-/srv/apps/automation}"
FAILED=0
ok()  { printf '  OK    %s\n' "$*"; }
info(){ printf '  --    %s\n' "$*"; }
bad() { printf '  FAIL  %s\n' "$*"; FAILED=1; }

# 目录名 → compose 服务名
PROGRAMS=(
  "rewards:rewards-run"
  "weread:weread-run"
  "epic:epic-run"
  "bilibili:bilibili-run"
  "tieba:tieba-run"
  "netease:netease-run"
)

echo "== 布局体检: $SUITE_DIR"

for f in compose.yaml run-all.sh schedule.json program-enabled.mjs alert-fail.mjs; do
    [ -f "$SUITE_DIR/$f" ] && ok "套件文件 $f" || bad "缺套件文件 $f"
done

for row in "${PROGRAMS[@]}"; do
    dir="${row%%:*}"; svc="${row##*:}"
    root="$SUITE_DIR/$dir"
    echo "-- $dir"
    if [ ! -d "$root" ]; then
        bad "$dir: 目录不存在"
        continue
    fi
    if [ ! -f "$root/run.sh" ]; then
        bad "$dir: 缺 run.sh · run-all.sh 会拿到退出码 127"
    elif [ ! -x "$root/run.sh" ]; then
        bad "$dir: run.sh 不可执行 · 调度会拿到退出码 126"
    else
        ok "$dir: run.sh 存在且可执行"
        # 一次性容器等 stdin 会挂住:入口必须把 stdin 断开
        grep -q '</dev/null >>' "$root/run.sh" \
            && ok "$dir: run.sh 已断开 stdin" \
            || bad "$dir: run.sh 的 docker compose run 没接 </dev/null · 交互式调用会挂住"
    fi
    grep -q "^  $svc:" "$SUITE_DIR/compose.yaml" 2>/dev/null \
        && ok "$dir: compose 服务 $svc 在位" \
        || bad "$dir: compose 里没有服务 $svc"
    [ -d "$root/logs" ] && ok "$dir: logs 目录在位" || bad "$dir: 缺 logs 目录"
    if [ -e "$root/logs/run.lock" ]; then
        bad "$dir: logs/run.lock 还在 · 上次运行可能没正常收尾"
    fi
    # 下面这些不阻断:形状随程序而异,只作提示
    [ -f "$root/Dockerfile" ] || info "$dir: 无 Dockerfile · 镜像可能在别处构建,确认一下"
    for d in data sessions; do
        [ -d "$root/$d" ] && info "$dir: 状态目录 $d 在位"
    done
done

echo
if [ "$FAILED" -eq 0 ]; then
    echo "[通过] 硬条件全过"
else
    echo "[失败] 有硬缺陷,按上面 FAIL 逐条补;补完再跑一次"
fi
exit "$FAILED"
