# Epic 限免领取:Node 程序本体 + 上游引擎 + 完整 Chromium + 虚拟显示
#
# 与另两个程序最大的不同:引擎刻意用**可见窗口**跑(上游 epic-games.js 里写死
# `headless: false`,注释说明 headless 会更容易触发 hCaptcha),所以容器里必须有
# 一个虚拟显示 —— Xvfb 提供 DISPLAY,entrypoint 里起它,不需要 noVNC
# (需要人工介入时程序会把结账链接推给企业微信,人在自己浏览器里点)。
FROM node:24-slim

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai \
    # 预置的浏览器在 node_modules/patchright-core/.local-browsers 下,
    # 不设这个变量 patchright 会去 /root/.cache/ms-playwright 找(2026-10-05 实测报 Executable doesn't exist)
    PLAYWRIGHT_BROWSERS_PATH=0

# apt 走腾讯云 Debian 镜像(构建期;deb.debian.org 实测只有几百 KB/s)。
# 装的是 Chromium 运行库 + Xvfb + 字体:缺 libnss3/libgbm 这类库时浏览器起不来。
RUN sed -i "s|deb.debian.org|mirrors.cloud.tencent.com|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl tzdata unzip xvfb x11-utils \
        fonts-liberation fonts-noto-cjk \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
        libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
        libasound2 libatspi2.0-0 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/epic

# 依赖先装:这一步只依赖 package.json,改 src/ 时不会重跑
COPY package.json /opt/epic/package.json
RUN npm install --omit=dev --no-audit --no-fund

# 预置 Chromium:patchright 默认从 Playwright CDN 下载(实测 ~130 KB/s 还会卡),
# 改成从 npmmirror 按 browsers.json 里记的版本号拉 chrome-for-testing 包,解到
# patchright 期望的位置并写 marker —— 有 marker 它就跳过下载,只做校验。
# 注意保留 chrome-linux64/ 这一层目录(铺平会报 Executable doesn't exist)。
# 放在 src/ 之前:186MB 的下载不该因为改一行源码就重来。
COPY deploy/fetch-browser.sh /opt/deploy/fetch-browser.sh
RUN bash /opt/deploy/fetch-browser.sh

# 程序本体 + 上游引擎(vendor 里的 free-games-claimer 原样收编,依赖共用根 package.json)
COPY src /opt/epic/src
COPY vendor /opt/epic/vendor
COPY deploy /opt/deploy

# 引擎(上游 lowdb)会写 vendor/free-games-claimer/data/epic-games.json;没有这个目录
# 就报 ENOENT: open '.../data/.epic-games.json.tmp'(2026-10-05 实测踩到)。
# compose 里还会把这个目录挂到宿主,这样每次运行的结果文件也能留档。
RUN mkdir -p /opt/epic/vendor/free-games-claimer/data

ENTRYPOINT ["/bin/bash", "/opt/deploy/run-once.sh"]
