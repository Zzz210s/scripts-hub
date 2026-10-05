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
#    构建前先把 chrome-headless-shell 预下到构建上下文(否则从 Playwright CDN 拉 114 MB
#    只有 ~130 KB/s,实测还会停住;npmmirror 是 13 MB/s):
./scripts/linux/fetch-cft-browser.sh 149.0.7827.55 1228 /srv/apps/automation/rewards/src/vendor
cd /srv/apps/automation/rewards/src && docker build -t automation-rewards:local .
cd /srv/apps/automation/weread && docker build -f Dockerfile -t automation-weread:local .
#   两个 Dockerfile 的 apt 与 pip 都指向国内镜像(实测 deb.debian.org 只有几百 KB/s):
#   apt: sed -i "s|deb.debian.org|mirrors.cloud.tencent.com|g" /etc/apt/sources.list.d/debian.sources
#   pip: -i https://mirrors.cloud.tencent.com/pypi/simple

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
| 只预览不真跑 | `docker compose -f /srv/apps/automation/compose.yaml run --rm -T --entrypoint node weread-run src/index.js plan`<br>注意必须带 `--entrypoint node` —— 服务的 entrypoint 是 `run-once.sh`(直接跑一次),不带它时后面跟的命令会被忽略 |

## 一次性容器的边界

- 两个服务都跑完即退,**没有常驻进程**;`docker ps` 里平时看不到它们,`docker ps -a | grep -E 'rewards-run|weread-run'` 只在运行中或异常残留时才有输出。
- 并发由两把锁保证:宿主 `state/*.flock`(编排与单程序)+ 容器内程序自己的锁。
- 看门狗超时会 `docker rm -f` 掉对应容器并记为失败(当天 12:00 那次会重试)。

## 自检脚本(手动跑,不进编排)

| 脚本 | 查什么 | 跑法 |
| --- | --- | --- |
| `rewards/deploy/smoke.sh` | 账号数、配置、登录态、浏览器能否启动、ConfigSync | `docker compose -f /srv/apps/automation/compose.yaml run --rm -T --entrypoint bash rewards-run /opt/deploy/smoke.sh` |
| `weread/deploy/test-peer.mjs` | 错峰:同伴锁判定(无锁 → 不忙;新锁 → 忙) | `... run --rm -T --entrypoint node weread-run /opt/deploy/test-peer.mjs` |
| `weread/deploy/test-welfare.mjs` | App 凭据换取 + 福利书币 / 周奖励接口 | `... run --rm -T --entrypoint node weread-run /opt/deploy/test-welfare.mjs` |
| Python 底座直跑(把目标压到 1–2 分钟) | 底座依赖与阅读链路 | `... run --rm -T --entrypoint bash weread-run -c 'cd /opt/weread && sed "s/^  target_duration: .*/  target_duration: \"1-2\"/" config.yaml > /tmp/t.yaml && python vendor/weread-bot/weread-bot.py --config /tmp/t.yaml'` |

2026-10-04 全量自检发现并修掉的问题:① 可用内存取 `os.freemem()` 在 Linux 上偏低(应读 `/proc/meminfo` 的 `MemAvailable`),
导致永远只开单集群;② `suite.env` 用 `.` 载入但没 `set -a`,参数进不了子进程(node 读不到阈值);
③ 看门狗 `docker rm -f <服务名>` 删不掉 compose run 的一次性容器(名字是自动生成的),要按
`label=com.docker.compose.service=<服务名>` 删;④ venv 用符号链暴露 `python` 会让 Python 解析不到
`pyvenv.cfg`,报"依赖装了却 ModuleNotFoundError",要 `ENV PATH=/opt/venv/bin:$PATH`。

## Epic 限免领取(第三个程序,2026-10-05 接入)

```bash
# 跑一次(宿主运行器,带看门狗)
/srv/apps/automation/epic/run.sh

# 看清单(不登录)/ 看状态 / 看 token
docker compose -f /srv/apps/automation/compose.yaml run --rm -T --entrypoint node epic-run src/cli.js probe
docker compose -f /srv/apps/automation/compose.yaml run --rm -T --entrypoint node epic-run src/cli.js status
docker compose -f /srv/apps/automation/compose.yaml run --rm -T --entrypoint node epic-run src/cli.js auth

# 重新登录(token 被吊销时;会打印链接与验证码,浏览器确认一次)
docker compose -f /srv/apps/automation/compose.yaml run --rm -T --entrypoint node epic-run src/cli.js login

# 某款游戏的预置结账链接(hCaptcha 退化路径手动用)
docker compose -f /srv/apps/automation/compose.yaml run --rm -T --entrypoint node epic-run src/cli.js link 1
```

微信读书的宿主看门狗是 **330 分钟**:程序在一次运行内会循环补读(最多 3 个会话,
每个会话上限 100 分钟),不达标就在同一次运行里再来一个,直到官方口径达标或用完配额。
配额由程序侧 `MAX_SESSIONS_PER_RUN` 控制(默认 3),总预算 `RUN_BUDGET_MINUTES`(默认 330)。

容器里跑的是 Xvfb + 可见窗口的 Chromium(上游引擎刻意不用 headless,为了少触发 hCaptcha)。
`data/state.json` 里 `days.<日期>.attempts` 是当天尝试次数,上限 2;要当天强制重跑就把它改成 0。
