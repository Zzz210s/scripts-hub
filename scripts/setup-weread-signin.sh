#!/usr/bin/env bash
#
# setup-weread-signin:自检 weread-signin 从全新克隆到能跑测试 / 能干跑,还差什么。
# 默认**不**访问网络、不登录、不读时长:只建模板、查凭据、跑离线测试与本地 status。
#
# 用法:bash scripts/setup-weread-signin.sh [--vendor]
#   --vendor  额外克隆底座 funnyzak/weread-bot(固定 commit)并 pip 安装依赖 —— 需要网络
#
# 退出码:0 测试与干跑都过;1 有阻塞项(看末尾结论)。
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROJ="$REPO_DIR/proj-weread-signin"
VENDOR_COMMIT=0cc9b5c309d1ede76b60f7fd453f6eb403b6307b
DO_VENDOR=0
for arg in "$@"; do
  case "$arg" in
    --vendor) DO_VENDOR=1 ;;
    -h | --help) sed -n '2,10p' "$0"; exit 0 ;;
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

printf '== weread-signin 自检(%s)==\n' "$PROJ"

# 1. 运行时
if command -v node >/dev/null 2>&1; then
  ver=$(node -p 'process.versions.node')
  if node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=11)?0:1)'; then
    ok "Node $ver(需要 >=20.11)"
  else
    bad "Node $ver 太旧,需要 >=20.11(用到 import.meta.dirname)"
  fi
else
  bad '没有 node 命令'
fi
if command -v python3 >/dev/null 2>&1; then
  ok "Python $(python3 -V 2>&1 | awk '{print $2}')(底座需要)"
else
  info '没有 python3 —— 只有底座上报层需要;测试与干跑不受影响'
fi

# 2. 模板文件(缺了就从 example 复制,幂等)
for pair in '.env:.env.example' 'config.yaml:config.yaml.example'; do
  dst="${pair%%:*}"; src="${pair#*:}"
  if [[ -f "$PROJ/$dst" ]]; then
    ok "$dst 已存在"
  elif [[ -f "$PROJ/$src" ]]; then
    cp "$PROJ/$src" "$PROJ/$dst"
    ok "$dst 由 $src 生成(按需编辑挑战日期)"
  else
    bad "缺 $src,无法生成 $dst"
  fi
done

# 3. 凭据就位情况(只报告;没有也能跑测试与 status)
mkdir -p "$PROJ/secrets"
required=(read-request.curl weread-api-key.txt)
optional=(wecom-webhook.txt app-credentials.json)
for f in "${required[@]}"; do
  if [[ -s "$PROJ/secrets/$f" ]]; then
    ok "凭据 secrets/$f 已就位"
  else
    info "缺必需凭据 secrets/$f —— 见 QUICKSTART.md「需要填的凭据」"
  fi
done
for f in "${optional[@]}"; do
  if [[ -s "$PROJ/secrets/$f" ]]; then
    ok "可选凭据 secrets/$f 已就位"
  else
    info "缺可选凭据 secrets/$f(不配则跳过对应功能)"
  fi
done

# 4. 底座 vendor(只有真跑阅读才需要)
if [[ -f "$PROJ/vendor/weread-bot/weread-bot.py" ]]; then
  have=$(git -C "$PROJ/vendor/weread-bot" rev-parse HEAD 2>/dev/null || echo unknown)
  if [[ "$have" == "$VENDOR_COMMIT" ]]; then
    ok "底座 vendor 已固定到 $VENDOR_COMMIT"
  else
    info "底座 vendor 在 $have,期望 $VENDOR_COMMIT"
  fi
elif ((DO_VENDOR)); then
  mkdir -p "$PROJ/vendor"
  if git clone --quiet https://github.com/funnyzak/weread-bot.git "$PROJ/vendor/weread-bot" &&
    git -C "$PROJ/vendor/weread-bot" checkout --quiet "$VENDOR_COMMIT"; then
    ok "底座已克隆并 checkout $VENDOR_COMMIT"
    if python3 -m pip install -r "$PROJ/vendor/weread-bot/requirements.txt" >/tmp/weread-setup-pip.log 2>&1; then
      ok '底座 Python 依赖已安装'
    else
      info '底座依赖安装失败,见 /tmp/weread-setup-pip.log'
    fi
  else
    bad '底座克隆失败(需要网络)'
  fi
else
  info '缺底座 vendor —— 只有真跑阅读需要;补:重跑本脚本加 --vendor'
fi

# 5. 离线测试(218 条,不访问网络)
if (cd "$PROJ" && node --test test/*.test.js >/tmp/weread-setup-test.log 2>&1); then
  ok "离线测试通过($(grep -m1 -oE 'tests [0-9]+' /tmp/weread-setup-test.log 2>/dev/null || echo '见日志'))"
else
  bad '离线测试失败,详见 /tmp/weread-setup-test.log'
fi

# 6. 干跑:本地 status(不登录、不读时长;缺 API Key 时只影响官方统计那一行)
if (cd "$PROJ" && node src/index.js status >/tmp/weread-setup-status.log 2>&1); then
  ok '干跑 status 通过(本地状态与关机倒计时)'
  sed -n '1,3p' /tmp/weread-setup-status.log | sed 's/^/       /'
else
  bad '干跑 status 失败,详见 /tmp/weread-setup-status.log'
fi

printf '\n结论:'
if ((FAILED)); then
  printf '有阻塞项,先按上面的 [阻塞] 处理。\n'
  exit 1
fi
printf '测试与干跑都过。要真跑阅读还需:secrets/read-request.curl + secrets/weread-api-key.txt + 底座 vendor。\n'
