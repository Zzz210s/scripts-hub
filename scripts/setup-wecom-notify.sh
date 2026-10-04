#!/usr/bin/env bash
#
# setup-wecom-notify:自检 wecom-notify 在本机能不能直接跑。**不发送任何消息**。
#
# 用法:bash scripts/setup-wecom-notify.sh [--install]
#   --install  额外执行 wecom-notify/install.sh,把 wecom-notify 注册成全局命令
#
# 退出码:0 全部通过(可能有提示);1 有阻塞项,看末尾结论。
# 本项目零运行时依赖,所以除 Node 版本外不需要任何前置安装。
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROJ="$REPO_DIR/wecom-notify"
DO_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --install) DO_INSTALL=1 ;;
    -h | --help) sed -n '2,11p' "$0"; exit 0 ;;
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

printf '== wecom-notify 自检(%s)==\n' "$PROJ"
[[ -f "$PROJ/package.json" ]] || {
  bad "找不到 $PROJ/package.json;确认仓库完整"
  exit 1
}

# 1. Node 版本(包声明 >=18)
if command -v node >/dev/null 2>&1; then
  ver=$(node -p 'process.versions.node')
  major=${ver%%.*}
  if ((major >= 18)); then ok "Node $ver(需要 >=18)"; else bad "Node $ver 太旧,需要 >=18"; fi
else
  bad '没有 node 命令'
fi

# 2. 单元测试(离线,不访问网络)
if (cd "$PROJ" && node --test >/tmp/wecom-setup-test.log 2>&1); then
  ok "单元测试通过($(grep -m1 -oE 'tests [0-9]+' /tmp/wecom-setup-test.log 2>/dev/null || echo '条数见日志'))"
else
  bad "单元测试失败,详见 /tmp/wecom-setup-test.log"
fi

# 3. webhook 就位情况(只报告,不发送)
webhook_found=''
if [[ -n "${WECOM_WEBHOOK_URL:-}" ]]; then webhook_found='环境变量 WECOM_WEBHOOK_URL'
elif [[ -f "$PROJ/wecom-webhook.txt" ]]; then webhook_found="$PROJ/wecom-webhook.txt"
elif [[ -f "$REPO_DIR/wecom-webhook.txt" ]]; then webhook_found="$REPO_DIR/wecom-webhook.txt"
fi
if [[ -n "$webhook_found" ]]; then
  ok "已找到 webhook 来源:$webhook_found"
else
  info '未找到 webhook —— 自检不需要它;要真发消息时:cp wecom-notify/wecom-webhook.txt.example wecom-notify/wecom-webhook.txt 再粘地址'
fi

# 4. CLI 干跑(只打印,不请求)
if (cd "$PROJ" && node cli.js --dry-run 'wecom-notify 自检' >/tmp/wecom-setup-dry.log 2>&1); then
  ok 'CLI 干跑通过(--dry-run 只打印不发送)'
  sed -n '1,4p' /tmp/wecom-setup-dry.log | sed 's/^/       /'
else
  bad "CLI 干跑失败,详见 /tmp/wecom-setup-dry.log"
fi

# 5. 可选:注册全局命令
if ((DO_INSTALL)); then
  if (cd "$PROJ" && sh install.sh >/tmp/wecom-setup-install.log 2>&1); then
    ok 'install.sh 完成(全局命令 wecom-notify 已注册)'
  else
    bad "install.sh 失败,详见 /tmp/wecom-setup-install.log"
  fi
else
  info '未注册全局命令;需要时重跑本脚本加 --install(或直接 node cli.js)'
fi

printf '\n结论:'
if ((FAILED)); then
  printf '有阻塞项,先按上面的 [阻塞] 处理。\n'
  exit 1
fi
printf 'wecom-notify 可以跑。缺 webhook 只影响真发消息,不影响测试与干跑。\n'
