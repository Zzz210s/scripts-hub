# B站每日任务:上游 .NET Console(固定 commit)+ 本项目的 Node 薄壳。
# 上游 RayWangQvQ/BiliBiliToolPro(GPL-3.0);镜像自用、不对外分发。
#
# 构建(在服务器应用目录 /srv/apps/automation/bilibili,里面要有 src/ deploy/ Dockerfile):
#   docker build -f Dockerfile -t automation-bilibili:local .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG UPSTREAM_SHA=2db0fc613f
# apt 走腾讯云 Debian 镜像(构建期;deb.debian.org 慢)。不同基底镜像的源文件位置可能不同,先判存在。
RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i "s|deb.debian.org|mirrors.cloud.tencent.com|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# 固定 commit 的源码只在构建期取用,不进本仓库;必须与 VENDOR_COMMIT.txt 里的 sha 一致。
RUN curl -fsSL "https://codeload.github.com/RayWangQvQ/BiliBiliToolPro/tar.gz/${UPSTREAM_SHA}" \
      | tar xz --strip-components=1
# 上游只 publish Web,这里的 publish 目标是 Console(一次性执行宿主,退出码 0/1)
RUN dotnet publish src/Ray.BiliBiliTool.Console/Ray.BiliBiliTool.Console.csproj -c Release -o /out

FROM mcr.microsoft.com/dotnet/runtime:10.0
ENV TZ=Asia/Shanghai \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    BILIBILI_CONSOLE_DIR=/app \
    BILIBILI_CONSOLE_DLL=/app/Ray.BiliBiliTool.Console.dll
# 零依赖项目不需要 npm,只要 node 可执行文件(同 Debian 系,glibc 兼容)
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=build /out /app
WORKDIR /app
COPY src /opt/bili/src
COPY deploy /opt/deploy
ENTRYPOINT ["/bin/bash", "/opt/deploy/run-once.sh"]
