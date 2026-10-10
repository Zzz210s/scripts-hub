#!/usr/bin/env bash
#
# setup-bilibili-tasks:从全新克隆自检 B站任务项目能不能跑(离线:不联网、不登录、不跑上游任务)。
#
# 用法:bash scripts/setup-bilibili-tasks.sh
# 退出码:0 可用;1 有阻塞项(看末尾结论)。
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROJ="$REPO_DIR/proj-bilibili-tasks"
FAILED=0
ok() { printf '[通过] %s\n' "$*"; }
info() { printf '[提示] %s\n' "$*"; }
bad() {
  printf '[阻塞] %s\n' "$*"
  FAILED=1
}

printf '== bilibili-tasks 自检(%s)==\n' "$PROJ"

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

# 2. 项目文件
for f in package.json src/cli.js src/run.js src/notify.js VENDOR_COMMIT.txt; do
  if [[ -f "$PROJ/$f" ]]; then ok "$f 已就位"; else bad "缺 $f"; fi
done
if [[ -f "$REPO_DIR/scripts/linux/bilibili/Dockerfile" ]]; then ok 'Dockerfile 已就位'; else bad '缺 scripts/linux/bilibili/Dockerfile'; fi

# 3. 离线测试(零依赖,不需要 npm install)
if [[ $FAILED -eq 0 ]]; then
  if (cd "$PROJ" && node --test test/*.test.js >/tmp/bilibili-setup-tests.log 2>&1); then
    count=$(grep -oE 'pass [0-9]+' /tmp/bilibili-setup-tests.log | head -1 | grep -oE '[0-9]+' || true)
    ok "离线测试通过:${count:-?} 条(完整输出 /tmp/bilibili-setup-tests.log)"
  else
    bad '离线测试失败;看 /tmp/bilibili-setup-tests.log'
  fi
fi

# 4. 干跑(不联网、不起子进程、不写状态)
if (cd "$PROJ" && node src/cli.js run --dry-run >/dev/null 2>&1); then
  ok 'run --dry-run 干跑正常'
else
  bad 'run --dry-run 干跑失败;单独跑一次看错误'
fi

# 5. 凭据(只有真跑才需要)
if [[ -f "$PROJ/secrets/cookies.json" ]]; then
  ok '登录凭据已存在(secrets/cookies.json)'
else
  cat <<'EOF'
[提示] 还没有登录凭据。第一次登录(必须有 .NET 运行环境,通常是在服务器容器里):
       cd /srv/apps/automation/bilibili
       docker compose -f /srv/apps/automation/compose.yaml run --rm -T bilibili-run \
         -e Ray_RunTasks=Login bash -c 'cd /app && dotnet Ray.BiliBiliTool.Console.dll'
       上游只轮询约 50 秒:看到 tool.lu 链接就立刻用手机 B站 App 扫,慢了就重跑。
EOF
fi
if [[ -f "$PROJ/secrets/wecom-webhook.txt" ]]; then
  ok '企业微信 webhook 已配置'
else
  info '缺 secrets/wecom-webhook.txt —— 不配则不推送,其余照常'
fi

printf '\n结论:'
if ((FAILED)); then
  printf '有阻塞项,先按上面的 [阻塞] 处理。\n'
  exit 1
fi
printf '可以跑:离线测试与干跑都不需要凭据;真跑要扫码登录一次并配 webhook。\n'
