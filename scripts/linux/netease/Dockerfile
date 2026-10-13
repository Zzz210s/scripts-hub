# 网易云音乐签到:纯 HTTP 的 Node 薄壳,零运行时依赖(没有浏览器、没有上游代码)。
#
# 构建(在服务器应用目录 /srv/apps/automation/netease,里面要有 package.json/ src/ scripts/ deploy/ Dockerfile):
#   docker build -f Dockerfile -t automation-netease:local .
FROM node:22-bookworm-slim
ENV TZ=Asia/Shanghai \
    NODE_ENV=production
WORKDIR /opt/netease
# package.json 必须进镜像:它写着 "type": "module",少了它这些 .js 会被当成 CommonJS 直接报错。
COPY package.json /opt/netease/package.json
COPY src /opt/netease/src
# 同伴互查要调 scripts/windows/run-state.js(见 src/guards.js 的 peerBusy 与调度约定)
COPY scripts /opt/netease/scripts
COPY deploy /opt/deploy
ENTRYPOINT ["/bin/bash", "/opt/deploy/run-once.sh"]
