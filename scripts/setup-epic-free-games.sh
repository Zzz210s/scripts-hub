#!/usr/bin/env bash
#
# setup-epic-free-games:从全新克隆自检 Epic 限免领取项目能不能跑(不登录、不领游戏、不联网)。
#
# 用法:bash scripts/setup-epic-free-games.sh
# 退出码:0 可用;1 有阻塞项(看末尾结论)。
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROJ="$REPO_DIR/proj-epic-free-games"
FAILED=0
ok() { printf '[通过] %s\n' "$*"; }
info() { printf '[提示] %s\n' "$*"; }
bad() {
  printf '[阻塞] %s\n' "$*"
  FAILED=1
}

printf '== epic-free-games 自检(%s)==\n' "$PROJ"

# 1. Node 版本(用到 import.meta.dirname 与内置 test runner)
if ! command -v node >/dev/null 2>&1; then
  bad '找不到 node;需要 Node >= 20.11'
else
  node_major=$(node -p 'process.versions.node.split(".")[0]')
  node_minor=$(node -p 'process.versions.node.split(".")[1]')
  if ((node_major > 20)) || ((node_major == 20 && node_minor >= 11)); then
    ok "Node $(node -v)"
  else
    bad "Node $(node -v) 太旧,需要 >= 20.11"
  fi
fi

# 2. 项目文件与上游引擎
for f in package.json src/cli.js src/notify.js vendor/free-games-claimer/epic-games.js VENDOR_COMMIT.txt; do
  if [[ -f "$PROJ/$f" ]]; then ok "$f 已就位"; else bad "缺 $f"; fi
done

# 3. 离线测试(零依赖,不需要 npm install)
if [[ $FAILED -eq 0 ]]; then
  if (cd "$PROJ" && node --test test/*.test.js >/tmp/epic-setup-tests.log 2>&1); then
    count=$(grep -oE 'pass [0-9]+' /tmp/epic-setup-tests.log | head -1 | grep -oE '[0-9]+' || true)
    ok "离线测试通过:${count:-?} 条(完整输出 /tmp/epic-setup-tests.log)"
  else
    bad "离线测试失败;看 /tmp/epic-setup-tests.log"
  fi
fi

# 4. 本地状态干跑(不联网)
if (cd "$PROJ" && node src/cli.js status >/dev/null 2>&1); then
  ok 'status 干跑正常'
else
  bad 'status 干跑失败;单独跑 node src/cli.js status 看错误'
fi

# 5. 引擎依赖(只有真跑才需要;测试不需要)
if (cd "$PROJ" && node -e "require.resolve('patchright')" >/dev/null 2>&1); then
  ok '引擎依赖已安装'
  if (cd "$PROJ" && npx --no-install patchright --version >/dev/null 2>&1); then
    ok 'patchright 浏览器可用'
  else
    info '还没装浏览器;真跑前执行:npx patchright install chromium'
  fi
else
  info '引擎依赖未安装(只有真跑需要,离线测试不受影响):'
  cat <<'EOF'
       cd proj-epic-free-games
       npm install
       npx patchright install chromium
EOF
fi

# 6. 凭据与登录态
if [[ -f "$PROJ/secrets/wecom-webhook.txt" ]]; then
  ok '企业微信 webhook 已配置'
else
  info '缺 secrets/wecom-webhook.txt —— 不配则不推送,其余照常'
fi
if [[ -d "$PROJ/data/browser" ]]; then
  ok '持久化浏览器 profile 已存在(登录态可能仍会过期)'
else
  cat <<'EOF'
[提示] 还没有浏览器登录态。第一次登录:
       cd proj-epic-free-games
       node src/cli.js login          # 打开浏览器人工登录一次,不保存密码
       登录后再启用计划任务:改 config/schedule.json 里 epic-free-games.enabled 为 true,
       然后 node scripts/apply-schedule.mjs --apply --yes
EOF
fi

printf '\n结论:'
if ((FAILED)); then
  printf '有阻塞项,先按上面的 [阻塞] 处理。\n'
  exit 1
fi
printf '可以跑:探测与测试都不需要凭据;真跑要装依赖、人工登录一次并配 webhook。\n'
