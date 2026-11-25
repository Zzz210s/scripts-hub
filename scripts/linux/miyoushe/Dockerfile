# 米游社签到镜像:上游 MiyoQian + 本地补丁(推送只留跑过的段、去掉详细日志)
#
# 不用上游镜像原名,是为了让 compose 里"这个容器跑的是本地构建"这件事一眼可见;
# 上游一更新就 `docker pull ghcr.chenby.cn/...` 再 tag 回 ghcr.io 名,然后重建本镜像。
FROM ghcr.io/marchen-orz/miyouqian:latest

# 基础镜像的 USER 已是非 root 的 myq:COPY 不跟着变属主的话,/tmp 里这个文件删不掉
COPY --chown=myq:myq patch_local.py /tmp/patch_local.py
RUN python /tmp/patch_local.py && rm -f /tmp/patch_local.py
