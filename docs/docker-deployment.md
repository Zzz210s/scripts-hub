# 容器化部署(云主机)

两个程序(微软积分、微信读书签到)从本机 Windows 计划任务搬到一台 7×24 在线的云主机上,
用 **Docker 容器**跑、由**宿主的 systemd timer** 顺序触发。本文是这套部署的设计与运维说明;
落地文件在 [`../scripts/linux/`](../scripts/linux/),实测记录见 0-Note 的
`记录-服务器部署pi与config-ai-2026-10.md`(本机文档,不进仓库)。

## 1. 为什么这么分工

本机的痛点是**机器不一定在线**:出门、断电、系统更新重启、02:00 的 `AutoShutdown0200`,
当天那一次就没了(Windows 计划任务不补跑)。云主机 7×24 在线,定时器一定触发。

| 层 | 放在哪 | 为什么 |
| --- | --- | --- |
| 触发 | 宿主 systemd timer(08:00 主力 + 12:00 兜底,`Persistent=true`) | 重启/关机错过的触发开机后补跑;不写调度代码 |
| 顺序 | 宿主 `run-all.sh`(flock 单实例) | 「一项结束才启动下一项」由它保证,不是靠错峰时刻去赌 |
| 守卫 / 通知 / 看门狗 | 宿主 `rewards/run.sh`、`weread/run.sh` | 与 Windows 版运行器一一对应,状态与日志留在宿主,容器随时可换 |
| 程序本体 | 容器(一次性,跑完即退) | 环境固定、依赖不污染宿主、升级就是换镜像 |
| 凭据 / 状态 | 宿主目录挂进容器 | 备份与迁移只搬目录,不进镜像 |

被否定的两条:① 两个常驻容器各自 cron(上游默认形态)—— 微软积分实测一次要 40 分钟以上,
固定槽位必然重叠,与「一项结束一项启动」冲突;② 单容器内顺序循环 —— 要把 Node+Python+Chromium
两套运行时塞进一个镜像,还得自己写调度循环,收益不抵复杂度。

## 2. 布局

```
/srv/apps/automation/
├── compose.yaml            两个服务的定义(都是一次性容器)
├── suite.env               可调参数(systemd EnvironmentFile)
├── run-all.sh              顺序编排(先微软积分,跑完再微信读书)
├── rewards/
│   ├── src/                上游源码(构建上下文,含三个本地补丁)
│   ├── deploy/             run-once.sh(容器内入口)+ run-config.js(内存闸门/并行集群)
│   ├── config/config.json  程序配置(挂进容器)
│   ├── sessions/           登录态 SQLite(挂进容器)
│   ├── logs/               程序日志、runner.log、last-run.state、run.lock(同伴判定用)
│   ├── wechat-bridge/      企业微信通知层(宿主侧调用,含 data/wecom-webhook.txt)
│   ├── .env                账号(ACCOUNT_N_EMAIL / PASSWORD)
│   └── run.sh              宿主侧运行器
├── weread/
│   ├── src/ vendor/        程序本体 + Python 底座(打镜像用)
│   ├── deploy/             run-once.sh(容器内入口)
│   ├── Dockerfile          程序镜像(底座依赖装进 venv)
│   ├── secrets/            网页 cookie、只读 API Key、App 凭据、企业微信 webhook
│   ├── data/ logs/         状态与日志
│   ├── .env config.yaml    守卫参数与底座配置
│   └── run.sh              宿主侧运行器
├── state/                  flock 锁与套件级状态
└── logs/suite.log          编排日志
```

镜像名:`automation-rewards:local`、`automation-weread:local`(本地构建,不走仓库)。

## 3. 调度与守卫

**触发**:`automation-suite.timer` → 08:00 与 12:00(`Persistent=true`,主机本地时区 Asia/Shanghai)。
12:00 那次是兜底:上午失败或没跑成时还有一次机会;两次都触发也不会重复跑 —— 幂等守卫一秒跳过。

**顺序**:`run-all.sh` 拿 `state/suite.flock` 排他锁 → `rewards/run.sh` → 等它返回 → `weread/run.sh`。
任一失败不影响另一个(各自有通知与当天重试机会)。

**微软积分守卫**(`rewards/run.sh`,逐条对应 Windows 版 `run-daily.bat`):

| 顺序 | 条件 | 结果 |
| --- | --- | --- |
| 0 | 已有同一次运行(flock) | 跳过 |
| 1 | 逻辑日(04:00 为界)当天已完成(状态 9)或已尝试 3 次 | 跳过;跳过原因当天只推一次 |
| 2 | `.env` 还是模板账号 | 跳过并提醒(需要人工处理) |
| 3 | 可用内存低于 `REWARDS_MIN_FREE_MB`(1200MB) | 跳过,**不消耗**当天尝试次数 |
| 4 | 看门狗超时(`REWARDS_RUN_TIMEOUT_MIN`,150 分钟) | 强杀容器,记为失败,当天剩余触发重试 |

去掉的只有「关机避让」与「安静时段」(云主机没有 02:00 关机,也没人在这台机器上阅读);
换掉的只有单实例锁:Windows 用「是否有 node 在跑」判残锁,Linux 用 `flock` —— 进程一死锁自动释放,
不存在残锁。另外仍会写一份 `logs/run.lock`(JSON,含 pid 与开始时间)给微信读书的错峰判定用。

**微信读书守卫**:程序自带(`src/guards.js`)—— 已达标 / 尝试次数用尽 / 同伴在跑 / 安静时段 /
凭据失效,加联网段的凭据体检与官方统计。云端 `.env` 的两处改动:`SHUTDOWN_TIME` 留空
(关机避让不生效,`minutesToShutdown` 返回 `Infinity`)、`BUSY_PEERS=/peers/rewards/run.lock`
(容器里挂进来的同伴锁)。

## 4. 通知

沿用本机同一套企业微信机器人 key(两个程序各自的 `wecom-webhook.txt` 直接搬过去),文案与频率规则
不变(见 [notification-convention.md](notification-convention.md)):真跑一次开始 + 结束两条;
跳过同一天同一种原因最多一条;凭据失效、读不到数据这类需要人工处理的不限次数。

## 5. 启动时间优化

| 措施 | 效果 |
| --- | --- |
| 镜像预先构建(代码、依赖、Chromium 都在镜像里) | 触发时零构建、零下载 |
| `SKIP_RANDOM_SLEEP=true` | 上游默认会随机等 5–50 分钟再跑,这里直接开跑 |
| `RUN_ON_START=false` + `CRON_SCHEDULE` 置为永不触发 | 容器只跑我们要求的那一次 |
| `REWARDS_FREE_MB_FOR_PARALLEL=1800`(上游默认 2500) | 云主机独占 2C4G,可用内存约 2.3GB → 开 2 集群并行跑账号,约省一半时间 |
| 一次性容器 + `mem_limit` | 跑完即退,不占常驻内存;超限只 OOM 容器自己 |

## 6. 凭据

| 文件 | 来源 | 失效后 |
| --- | --- | --- |
| `rewards/.env` | 本机 `%REWARDS_DIR%\.env`(5 个账号) | 改密码就改这里,不用重建镜像 |
| `rewards/config/config.json` | 本机 `%REWARDS_DIR%\config.json` | 配置项改动直接改文件 |
| `rewards/sessions/sessions.db` | 本机 `%REWARDS_DIR%\sessions\` | 失效会退回密码登录;删掉即强制重登 |
| `rewards/wechat-bridge/data/wecom-webhook.txt` | 本机同路径 | 机器人被移出群就重新复制 |
| `weread/secrets/read-request.curl` | 本机 `%WEREAD_DIR%\secrets\` | `wr_skey` 约 1.5 小时,程序自动续期;超 360 天或别处退出登录才需重抓 |
| `weread/secrets/weread-api-key.txt` | 同上 | 换新的后跑一次只读校验 |
| `weread/secrets/app-*.json` | 同上 | App token 过期时重新扫码(`app-login.js qr` + `wait`) |

所有凭据只在宿主目录里(600 权限),不进镜像、不进仓库。**同一账号不要两边同时跑**:
微软的登录态与微信读书的 cookie 都会被对方顶掉,所以迁到云主机后本机计划任务要停掉
(见第 8 节)。

## 7. 验证

```bash
# 宿主
systemctl list-timers automation-suite.timer        # 下一次触发时刻
sudo systemctl start automation-suite.service       # 手动触发一次(看日志)
journalctl -u automation-suite.service -n 50 --no-pager
tail -f /srv/apps/automation/logs/suite.log
tail -f /srv/apps/automation/rewards/logs/runner.log

# 单程序(跳过编排)
/srv/apps/automation/rewards/run.sh
/srv/apps/automation/weread/run.sh

# 容器层面
docker compose -f /srv/apps/automation/compose.yaml run --rm -T weread-run   # 真跑一次
docker compose -f /srv/apps/automation/compose.yaml run --rm -T rewards-run
```

判定「今天那次算不算成功」:微软积分看 `rewards/logs/last-run.state`(`<逻辑日> 9` = 已完成;
`3..8` = 当天尝试都失败);微信读书看 `weread/data/state.json` 的 `done` 与 `attempts`。

## 8. 本机怎么办

迁到云主机后,**停掉本机的 Windows 计划任务**(否则两边同一天都跑:微软账号会互相顶掉登录态,
微信读书的时长上报也会重复):

```powershell
Disable-ScheduledTask -TaskName MicrosoftRewardsScript
Disable-ScheduledTask -TaskName WeReadSignIn
```

想留兜底就先观察几天:确认云主机连续几天都跑成、企业微信每天都收到推送,再停本机任务。
智慧树 Autovisor 仍只在本机(需要图形会话),不受影响。

## 9. 运维

| 动作 | 命令 |
| --- | --- |
| 看今天跑没跑 | `cat rewards/logs/last-run.state`、`cat weread/data/state.json` |
| 手动补跑一次 | `sudo systemctl start automation-suite.service` |
| 暂停微信读书 | 容器外创建 `weread/data/paused` 文件(或 `docker compose run --rm -T weread-run node src/index.js pause`) |
| 升级微软积分 | `cd rewards/src && git pull`(或换上游版本 + `git apply` 补丁)→ `docker build -t automation-rewards:local .` |
| 升级微信读书 | 更新 `weread/src`(从本机工作区同步)→ `docker build -f weread/Dockerfile -t automation-weread:local weread/` |
| 看容器有没有残留 | `docker ps -a | grep -E "rewards-run|weread-run"`(一次性容器正常跑完即消失) |
| 日志占空间 | `logs/` 里每次运行会轮转一份 `previous-run.log`;磁盘 48GB 空闲,暂时不用管 |

## 10. 与 Windows 版的差异一览

| 项 | Windows 本机 | 云主机(本文) |
| --- | --- | --- |
| 触发 | 计划任务:登录后 + 08:00 起每 2 小时(14 小时窗口) | systemd timer:08:00 + 12:00,`Persistent=true` |
| 补跑 | 不补跑,靠窗口内多次触发 | 错过的触发开机后补跑 |
| 顺序 | 错峰时刻 + 同伴互查 | 编排脚本严格顺序 |
| 单实例锁 | `logs\run.lock` + 进程实况判残锁 | `flock`(自动释放)+ 同伴用的 JSON 锁 |
| 关机避让 | 有(02:00 关机前 30 分钟不启动) | 无(云主机不关机) |
| 安静时段 | 有(20:00-23:00) | 微信读书保留;微软积分不看这个 |
| 程序形态 | 裸装 Node/Python | 容器(镜像本地构建) |
