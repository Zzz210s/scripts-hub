# 服务器侧体检工具(scripts-hub 的「基础模块」):一个按需跑的容器,不是常驻服务。
#
# 为什么做成容器而不是装在宿主上:
#   - 宿主上什么都不用装(node/git/restic 都在镜像里),用完即走,平时零进程零内存;
#   - 四个检查共用同一个镜像,不必各装一套;
#   - 仓库本体留在宿主(~/scripts-hub 的克隆),挂进来只读 —— 更新工具只要 git pull,
#     不需要重建镜像。
#
# 用到的四个脚本都是纯 Node、零 npm 依赖(实测 import 里没有第三方包),所以镜像里
# 不需要 npm install。
FROM node:24-slim

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai

# git:check-privacy.mjs 用 `git ls-files` 枚举仓库文件
# restic:备份盘点之后真要推时用得上(现在只跑 --dry-run,先装上免得以后重建)
# diffutils:对比生成的 systemd unit 与 /etc/systemd/system 里现装的那份
RUN sed -i "s|deb.debian.org|mirrors.cloud.tencent.com|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends git restic diffutils ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    # 挂进来的仓库属主是宿主用户(ubuntu),容器里是 root —— 不加这条 git 会以
    # "detected dubious ownership" 拒绝执行,check-privacy 的 git ls-files 直接失败
    && git config --system --add safe.directory '*'

COPY entrypoint.sh /opt/suite-check/entrypoint.sh
ENTRYPOINT ["/bin/bash", "/opt/suite-check/entrypoint.sh"]
