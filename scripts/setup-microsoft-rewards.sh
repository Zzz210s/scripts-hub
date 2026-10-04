#!/usr/bin/env bash
#
# setup-microsoft-rewards:自检 microsoft-rewards 从全新克隆到能跑测试 / 能构建,还差什么。
# 不登录、不跑积分:只装依赖、建 .env 模板、构建、跑离线测试。
#
# 用法:bash scripts/setup-microsoft-rewards.sh [--no-install] [--no-browser] [--no-build]
#   --no-install  跳过 npm ci
#   --no-browser  跳过 npx patchright install chromium
#   --no-build    跳过 npm run build
# 默认全做(需要网络与磁盘,约 300MB 依赖 + 约 150MB 浏览器)。
#
# 退出码:0 通过的步骤都过;1 有阻塞项(看末尾结论)。
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROJ="$REPO_DIR/proj-microsoft-rewards"
DO_INSTALL=1
DO_BROWSER=1
DO_BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-install) DO_INSTALL=0 ;;
    --no-browser) DO_BROWSER=0 ;;
    --no-build) DO_BUILD=0 ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    *) printf '未知参数:%s\n' "$arg" >&2; exit 2 ;;
  esac
done

FAILED=0
ok() { printf '[通过] %s\n' "$*"; }
info() { printf '[提示] %s\n' "$*"; }
bad() {
  printf '[阻塞] %s\n' "$*"
  FAILED=1
}

printf '== microsoft-rewards 自检(%s)==\n' "$PROJ"

# 1. Node 版本(上游声明 >=24)
if command -v node >/dev/null 2>&1; then
  ver=$(node -p 'process.versions.node')
  if node -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)'; then
    ok "Node $ver(需要 >=24)"
  else
    bad "Node $ver 太旧,上游要求 >=24"
  fi
else
  bad '没有 node 命令'
fi

# 2. 依赖
if ((DO_INSTALL)); then
  if (cd "$PROJ" && npm ci --no-audit --no-fund >/tmp/ms-setup-install.log 2>&1); then
    ok 'npm ci 完成(168 个包左右)'
  else
    bad 'npm ci 失败,详见 /tmp/ms-setup-install.log'
  fi
elif [[ -d "$PROJ/node_modules" ]]; then
  ok 'node_modules 已存在(--no-install)'
else
  info '跳过 npm ci 且没有 node_modules —— 构建会失败'
fi

# 3. 浏览器(Playwright/Patchright 驱动)
if ((DO_BROWSER)); then
  if (cd "$PROJ" && npx patchright install chromium >/tmp/ms-setup-browser.log 2>&1); then
    ok 'patchright chromium 就位'
  else
    bad 'patchright chromium 安装失败,详见 /tmp/ms-setup-browser.log'
  fi
elif [[ -d "$HOME/AppData/Local/ms-playwright" || -d "$HOME/.cache/ms-playwright" ]]; then
  ok '浏览器缓存已存在(--no-browser)'
else
  info '跳过浏览器安装 —— 真跑积分前必须装'
fi

# 4. 账号模板
if [[ -f "$PROJ/.env" ]]; then
  ok '.env 已存在(账号凭据)'
elif [[ -f "$PROJ/env.example" ]]; then
  cp "$PROJ/env.example" "$PROJ/.env"
  ok '.env 由 env.example 生成 —— 按需填 ACCOUNT_N_EMAIL / ACCOUNT_N_PASSWORD'
else
  bad '缺 env.example,无法生成 .env'
fi
info '企业微信 webhook 放 wechat-bridge/data/wecom-webhook.txt(可选,不配则不推送)'

# 5. 构建
if ((DO_BUILD)); then
  if (cd "$PROJ" && npm run build >/tmp/ms-setup-build.log 2>&1); then
    ok 'npm run build 完成(dist/ 已生成,被 gitignore)'
  else
    bad '构建失败,详见 /tmp/ms-setup-build.log'
  fi
elif [[ -d "$PROJ/dist" ]]; then
  ok 'dist/ 已存在(--no-build)'
else
  info '跳过构建且没有 dist/ —— 真跑积分前必须构建'
fi

# 6. 离线测试(26 条:通知层 21 + 运行器 5)
if (cd "$PROJ" && node --test wechat-bridge/test/*.test.js >/tmp/ms-setup-test1.log 2>&1); then
  ok "通知层测试通过($(grep -m1 -oE 'tests [0-9]+' /tmp/ms-setup-test1.log 2>/dev/null || echo '见日志'))"
else
  bad '通知层测试失败,详见 /tmp/ms-setup-test1.log'
fi
if (cd "$PROJ" && node --test scripts/windows/run-state.test.js >/tmp/ms-setup-test2.log 2>&1); then
  ok "运行器测试通过($(grep -m1 -oE 'tests [0-9]+' /tmp/ms-setup-test2.log 2>/dev/null || echo '见日志'))"
else
  bad '运行器测试失败,详见 /tmp/ms-setup-test2.log'
fi

printf '\n结论:'
if ((FAILED)); then
  printf '有阻塞项,先按上面的 [阻塞] 处理。\n'
  exit 1
fi
printf '构建与测试都过。要真跑积分还需:.env 里的账号密码 + 登录态(sessions/);可选 webhook。\n'
