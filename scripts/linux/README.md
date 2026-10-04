# Linux 部署(云主机)

把微软积分与微信读书签到搬到一台 7×24 的 Linux 云主机上跑:容器化 + systemd timer 顺序触发。
设计与取舍见 [`../../docs/docker-deployment.md`](../../docs/docker-deployment.md),这里只讲怎么用。

## 部署到新机器

```bash
# 1. 目录骨架(套件根 = /srv/apps/automation)
sudo mkdir -p /srv/apps/automation/{rewards,weread,state,logs}
sudo chown -R "$USER" /srv/apps/automation

# 2. 部署文件(本目录内容)
tar -C scripts/linux -cf - . | tar -C /srv/apps/automation -xf -
chmod +x /srv/apps/automation/{run-all.sh,rewards/run.sh,weread/run.sh} \
         /srv/apps/automation/{rewards,weread}/deploy/run-once.sh

# 3. 程序本体与凭据(从本机搬;不进仓库,权限 600)
#    rewards/: src/(上游源码+补丁)、deploy/、config/config.json、sessions/、
#               wechat-bridge/(含 data/wecom-webhook.txt)、.env
#    weread/ : src/、vendor/weread-bot/、Dockerfile、deploy/、config.yaml、
#               secrets/、data/、.env
#    见 docs/docker-deployment.md 第 6 节的凭据清单

# 4. 构建镜像(首次约 15–30 分钟:apt + npm ci + Chromium 下载)
cd /srv/apps/automation/rewards/src && docker build -t automation-rewards:local .
cd /srv/apps/automation/weread && docker build -f Dockerfile -t automation-weread:local .
#   提示:容器内 apt 走 deb.debian.org 很慢,构建前可在 Dockerfile 里换成国内镜像:
#   sed -i "s|deb.debian.org|mirrors.cloud.tencent.com|g" /etc/apt/sources.list.d/debian.sources

# 5. systemd 定时器
sudo cp /srv/apps/automation/systemd/automation-suite.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now automation-suite.timer
systemctl list-timers automation-suite.timer
```

## 日常

| 动作 | 命令 |
| --- | --- |
| 手动跑一整套 | `sudo systemctl start automation-suite.service` |
| 手动跑单个 | `/srv/apps/automation/rewards/run.sh` / `/srv/apps/automation/weread/run.sh` |
| 看编排日志 | `tail -f /srv/apps/automation/logs/suite.log` |
| 看守卫与跳过原因 | `tail -f /srv/apps/automation/rewards/logs/runner.log` |
| 今天算不算完成 | `cat /srv/apps/automation/rewards/logs/last-run.state`(9 = 已完成)、`cat /srv/apps/automation/weread/data/state.json` |
| 暂停 / 恢复 | `touch|rm /srv/apps/automation/weread/data/paused` |
| 只预览不真跑 | `docker compose -f /srv/apps/automation/compose.yaml run --rm -T weread-run node src/index.js plan` |

## 一次性容器的边界

- 两个服务都跑完即退,**没有常驻进程**;`docker ps` 里平时看不到它们,`docker ps -a | grep -E 'rewards-run|weread-run'` 只在运行中或异常残留时才有输出。
- 并发由两把锁保证:宿主 `state/*.flock`(编排与单程序)+ 容器内程序自己的锁。
- 看门狗超时会 `docker rm -f` 掉对应容器并记为失败(当天 12:00 那次会重试)。
