# 微信读书签到:Node 程序本体 + Python 底座(上游 funnyzak/weread-bot,固定 commit)
#
# 为什么自带底座:程序本体只负责算目标、续期凭据、上报与通知,真正"读"的那一层是
# Python 写的第三方底座(见 proj-weread-signin/QUICKSTART.md 的"底座"一节)。底座源码
# 随镜像一起打进 /opt/weread/vendor,不在构建时联网 clone(云主机上 github.com 时通时断)。
FROM node:24-slim

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

# 底座依赖装进 venv(PEP 668 的 externally-managed 限制),再把 python/python3 指过去 ——
# 程序本体里 spawn 的二进制名是写死的 'python'(src/run.js:109),容器里必须有这个名字。
COPY vendor/weread-bot /opt/weread/vendor/weread-bot
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r /opt/weread/vendor/weread-bot/requirements.txt \
    && ln -sf /opt/venv/bin/python /usr/local/bin/python \
    && ln -sf /opt/venv/bin/python /usr/local/bin/python3

# 程序本体(Node 侧零第三方依赖)
COPY src /opt/weread/src
COPY package.json /opt/weread/package.json

WORKDIR /opt/weread
ENTRYPOINT ["/bin/bash", "/opt/deploy/run-once.sh"]
