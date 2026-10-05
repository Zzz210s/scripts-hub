#!/usr/bin/env bash
# 容器内一次性运行:起虚拟显示 → 跑一次 Epic 限免领取(守卫、通知、状态都由程序自己管)
set -euo pipefail

# 引擎刻意用可见窗口跑(headless 更容易触发 hCaptcha),所以给一个虚拟显示。
# 用 Xvfb 而不是 noVNC:需要人工介入时,程序会把结账链接推给企业微信,人在自己浏览器里点。
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!
trap 'kill "$XVFB_PID" 2>/dev/null || true' EXIT

# 等 X 起来(最多 5 秒),没起来就直接失败,别让浏览器报一堆看不懂的错
for _ in $(seq 1 50); do
    [ -e /tmp/.X11-unix/X99 ] && break
    sleep 0.1
done
[ -e /tmp/.X11-unix/X99 ] || { echo "[run-once] Xvfb 没起来,见 /tmp/xvfb.log" >&2; exit 2; }

# 清掉上一次运行残留的 profile 锁。
# 为什么必须清:容器每次跑都是**新的 hostname**,而 Chromium 的 SingletonLock 里记着
# 上次的 hostname —— 残留锁会被判成「被另一台电脑上的 Chromium 占用」而拒绝启动,
# 报 process_singleton_posix.cc:365 然后卡到超时(2026-10-05 实测:一次崩溃留下的锁
# 让后续每次运行都拿不到 profile,领取全变成「有未领取」)。
# 单实例由宿主 flock 与编排顺序保证,所以这里直接清是安全的。
rm -f /opt/epic/data/browser/Singleton*

cd /opt/epic
echo "[run-once] $(date -Is) start(DISPLAY=$DISPLAY)"
exec node src/cli.js run
