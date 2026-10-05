#!/usr/bin/env bash
# 构建期:把 patchright 需要的浏览器预置进镜像(npmmirror 拉,别走 Playwright CDN)。
#
# 为什么:patchright 的 `npx patchright install` 从 cdn.playwright.dev 下 ~150MB,
# 实测只有 ~130 KB/s 而且会中途停住;npmmirror 同一个包是十几 MB/s。
# 做法与微软积分镜像同源:下 chrome-for-testing 的 linux64 包,解到 patchright 期望的
# node_modules/patchright-core/.local-browsers/<目录名>/,再写两个 marker
# (INSTALLATION_COMPLETE / DEPENDENCIES_VALIDATED),patchright 见到就跳过下载。
#
# 要下两个(2026-10-05 实测:只下完整版会在会话注入那步报
# 「Executable doesn't exist at .../chromium_headless_shell-1243/...」):
#   chromium                  完整版 —— 引擎刻意用可见窗口跑(headless 更容易触发 hCaptcha)
#   chromium-headless-shell   无头壳 —— 注入 cookie 那一步是 headless 的
#
# 版本不写死:从 browsers.json 里读 revision 与 browserVersion,保证与安装到的
# patchright 版本一致(升级依赖后重新构建即可,不用改这个脚本)。
#
# 注意 read 的写法:用 herestring 而不是进程替换 —— `read ... < <(node -e '...')`
# 在 node 输出不带换行时会返回 1,配上 set -e 就变成"一行输出都没有的静默退出"
# (2026-10-05 实测踩到,构建日志里只能看到一个空的 exit code 1)。
set -euo pipefail

cd /opt/epic
BROWSERS_JSON=node_modules/patchright-core/browsers.json
[ -f "$BROWSERS_JSON" ] || { echo "[fetch-browser] 找不到 $BROWSERS_JSON(依赖没装成功?)" >&2; exit 1; }

# 从 browsers.json 里取某个浏览器的 revision 与版本号(node 侧只打印一行)
info_of() {
    node -e '
const name = process.argv[1];
const b = require("/opt/epic/node_modules/patchright-core/browsers.json").browsers.find((x) => x.name === name);
if (!b) { console.error(`browsers.json 里没有 ${name}`); process.exit(1); }
process.stdout.write(`${b.revision} ${b.browserVersion}`)
' "$1"
}

fetch_one() {
    local kind="$1" name="$2" zipname="$3" inner="$4"
    local info revision version dirname dir url
    info="$(info_of "$name")"
    read -r revision version <<< "$info"
    dirname="${name//-/_}"
    dir="node_modules/patchright-core/.local-browsers/${dirname}-${revision}"
    url="https://cdn.npmmirror.com/binaries/chrome-for-testing/${version}/linux64/${zipname}"

    echo "[fetch-browser] ${kind}(${name})revision=${revision} version=${version}"
    curl -fL --retry 3 --retry-delay 2 -o /tmp/browser.zip "$url"
    rm -rf "/tmp/unzip-${dirname}"
    mkdir -p "$dir" "/tmp/unzip-${dirname}"
    unzip -q /tmp/browser.zip -d "/tmp/unzip-${dirname}"
    cp -r "/tmp/unzip-${dirname}/${inner}" "$dir/"
    touch "$dir/INSTALLATION_COMPLETE" "$dir/DEPENDENCIES_VALIDATED"
    rm -rf "/tmp/unzip-${dirname}" /tmp/browser.zip
    echo "[fetch-browser] ${kind} 完成:$(du -sh "$dir" | cut -f1)"
}

fetch_one "完整 Chromium" "chromium" "chrome-linux64.zip" "chrome-linux64"
fetch_one "无头壳" "chromium-headless-shell" "chrome-headless-shell-linux64.zip" "chrome-headless-shell-linux64"

echo "[fetch-browser] 全部完成"
