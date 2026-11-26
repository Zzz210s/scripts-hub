# 淘宝闪购吃货豆:真实页面点击领取。零 npm 依赖,只需要一个 Chromium。
#
# 构建(在项目目录里,要有 package.json / src/ / deploy / Dockerfile):
#   docker build -f Dockerfile -t automation-shanggou:local .
FROM node:22-bookworm-slim

# deb.debian.org 在这台机器上只有几百 KB/s,换腾讯云镜像(与套件里其它镜像一致)
RUN sed -i "s|deb.debian.org|mirrors.cloud.tencent.com|g" /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-noto-cjk ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Shanghai \
    NODE_ENV=production \
    SHANGGOU_CHROME=/usr/bin/chromium \
    CHROME_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu" \
    SHANGGOU_HEADLESS=1

WORKDIR /opt/shanggou
COPY package.json /opt/shanggou/package.json
COPY src /opt/shanggou/src
COPY deploy /opt/deploy

ENTRYPOINT ["/bin/bash", "/opt/deploy/run-once.sh"]
