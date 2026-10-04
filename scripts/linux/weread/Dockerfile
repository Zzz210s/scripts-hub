# 微信读书签到:Node 程序本体 + Python 底座(上游 funnyzak/weread-bot,固定 commit)
#
# 为什么自带底座:程序本体只负责算目标、续期凭据、上报与通知,真正"读"的那一层是
# Python 写的第三方底座(见 proj-weread-signin/QUICKSTART.md 的"底座"一节)。底座源码
# 随镜像一起打进 /opt/weread/vendor,不在构建时联网 clone(云主机上 github.com 时通时断)。
FROM node:24-slim

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai

# 构建加速:apt 走腾讯云 Debian 镜像(仅构建期;deb.debian.org 实测只有几百 KB/s)
RUN sed -i "s|deb.debian.org|mirrors.cloud.tencent.com|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

# 底座依赖装进 venv(PEP 668 的 externally-managed 限制)。pip 也走腾讯云镜像。
COPY vendor/weread-bot /opt/weread/vendor/weread-bot
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -i https://mirrors.cloud.tencent.com/pypi/simple --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -i https://mirrors.cloud.tencent.com/pypi/simple -r /opt/weread/vendor/weread-bot/requirements.txt

# 让 python / python3 落到 venv 里的解释器(程序本体 spawn 的二进制名是写死的 "python",
# 见 src/run.js:109)。**不能用 ln -s 指过去**:符号链会让 Python 把 sys.executable 解析成
# /usr/bin/python3,找不到 venv 的 pyvenv.cfg,于是出现"依赖装了却报 ModuleNotFoundError"
# (2026-10-04 实测踩到)。PATH 前置才是 venv 的正常用法。
ENV PATH="/opt/venv/bin:$PATH"

# 保险:登录 shell 会读 /etc/profile 重置 PATH,那里也要能拿到 venv
RUN printf 'PATH="/opt/venv/bin:$PATH"\n' > /etc/profile.d/venv.sh

# 程序本体(Node 侧零第三方依赖)
COPY src /opt/weread/src
COPY package.json /opt/weread/package.json

WORKDIR /opt/weread
ENTRYPOINT ["/bin/bash", "/opt/deploy/run-once.sh"]
