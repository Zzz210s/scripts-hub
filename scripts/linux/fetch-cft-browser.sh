#!/usr/bin/env bash
# 把 chrome-headless-shell 预先下到构建上下文,避免构建时从 Playwright CDN 慢下载。
#
# 为什么需要:实测从 cdn.playwright.dev 拉 114 MB 只有 ~130 KB/s,还会中途停住;
# 从 npmmirror 拉同一个文件是 13 MB/s(9 秒)。下载后在 Dockerfile 里解压进
# node_modules/patchright-core/.local-browsers/chromium_headless_shell-<revision>/,并写
# INSTALLATION_COMPLETE / DEPENDENCIES_VALIDATED 两个 marker —— patchright 见到 marker 就跳过下载。
#
# 用法:
#   ./fetch-cft-browser.sh [版本] [revision] [目标目录]
#   ./fetch-cft-browser.sh 149.0.7827.55 1228 /srv/apps/automation/rewards/src/vendor
#
# 版本与 revision 必须与 patchright-core/browsers.json 里 chromium-headless-shell 的一致:
#   node -e "const b=require('patchright-core/browsers.json').browsers.find(x=>x.name==='chromium-headless-shell');console.log(b.revision, b.browserVersion)"
set -euo pipefail

VER="${1:-149.0.7827.55}"
REV="${2:-1228}"
DEST="${3:-/srv/apps/automation/rewards/src/vendor}"
URL="https://cdn.npmmirror.com/binaries/chrome-for-testing/${VER}/linux64/chrome-headless-shell-linux64.zip"

mkdir -p "$DEST"
echo "下载 $URL"
curl -fL --progress-bar -o "$DEST/chrome-headless-shell-linux64.zip" "$URL"
ls -lh "$DEST/chrome-headless-shell-linux64.zip"
echo
echo "提示:Dockerfile 里的目录名是 chromium_headless_shell-${REV};换了版本/revision 要同步改 Dockerfile。"
