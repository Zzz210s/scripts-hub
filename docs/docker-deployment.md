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
| 预置 `chrome-headless-shell`(npmmirror 下好放进构建上下文) | 构建从 40+ 分钟降到 5 分钟:Playwright CDN 实测 ~130 KB/s 且会停住,npmmirror 是 13 MB/s |
| `SKIP_RANDOM_SLEEP=true` | 上游默认会随机等 5–50 分钟再跑,这里直接开跑 |
| `RUN_ON_START=false` + `CRON_SCHEDULE` 置为永不触发 | 容器只跑我们要求的那一次 |
| `REWARDS_FREE_MB_FOR_PARALLEL=1800`(上游默认 2500) | 云主机独占 2C4G,可用内存约 2.3GB → 开 2 集群并行跑账号,约省一半时间 |
| 一次性容器 + `mem_limit` | 跑完即退,不占常驻内存;超限只 OOM 容器自己 |

## 5.1 构建镜像时的两个坑(实测)

1. **容器内 apt 走 `deb.debian.org` 只有几百 KB/s**:42 个包下 20 多分钟还没完;换成
   `mirrors.cloud.tencent.com` 后 97 个包 28 秒。两个 Dockerfile 构建前都改。
2. **Playwright CDN 下载 `chrome-headless-shell` 会卡住**(114 MB,~130 KB/s):
   改用 `scripts/linux/fetch-cft-browser.sh` 从 npmmirror 预下(13 MB/s、9 秒)放进构建上下文,
   Dockerfile 里解压到 `node_modules/patchright-core/.local-browsers/chromium_headless_shell-<revision>/`
   并写 `INSTALLATION_COMPLETE` / `DEPENDENCIES_VALIDATED` marker,让 patchright 跳过下载只做校验。
   **注意保留 `chrome-headless-shell-linux64/` 这一层目录** —— 铺平会报「Executable doesn't exist」。
   顺带:node:24-slim 里没有 `unzip`,apt 列表要加。

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
# 想跑程序自己的子命令(status / plan / verify / auth / pause)必须显式覆盖 entrypoint:
docker compose -f /srv/apps/automation/compose.yaml run --rm -T --entrypoint node weread-run src/index.js status

# 自检脚本(不进编排,手动跑)
docker compose -f /srv/apps/automation/compose.yaml run --rm -T --entrypoint bash rewards-run /opt/deploy/smoke.sh
docker compose -f /srv/apps/automation/compose.yaml run --rm -T --entrypoint node weread-run /opt/deploy/test-peer.mjs
docker compose -f /srv/apps/automation/compose.yaml run --rm -T --entrypoint node weread-run /opt/deploy/test-welfare.mjs
```

判定「今天那次算不算成功」:微软积分看 `rewards/logs/last-run.state`(`<逻辑日> 9` = 已完成;
`3..8` = 当天尝试都失败);微信读书看 `weread/data/state.json` 的 `done` 与 `attempts`。

## 7.1 全量自检发现并修掉的问题(2026-10-04)

| 症状 | 根因 | 修法 |
| --- | --- | --- |
| 永远只开 1 个集群(慢一倍) | `os.freemem()` 在 Linux 上返回 `MemFree`,把可回收页缓存算作已用;同一时刻 `MemAvailable` 2362MB 而它给出不到 1000MB | `run-config.js` 优先读 `/proc/meminfo` 的 `MemAvailable`,读不到才退回 `os.freemem()` |
| 阈值改了不生效 | `suite.env` 用 `.` 载入但没 `set -a`,变量只存在于当前 shell,node 子进程读不到 | 三个脚本都改成 `set -a; . suite.env; set +a` |
| 看门狗超时后容器还在跑 | `docker rm -f rewards-run` 删不掉 `compose run` 的一次性容器(真名是 `automation-rewards-run-run-<hash>`) | 按标签删:`docker ps -aq --filter "label=com.docker.compose.service=rewards-run" \| xargs -r docker rm -f` |
| 底座报「缺少依赖: PyYAML, requests, httpx」 | venv 用 `ln -s /opt/venv/bin/python /usr/local/bin/python` 暴露:符号链让 Python 把 `sys.executable` 解析成 `/usr/bin/python3`,找不到 `pyvenv.cfg` → 看不到 venv 的 site-packages | 改用 `ENV PATH="/opt/venv/bin:$PATH"`(并加 `/etc/profile.d/venv.sh` 兜住登录 shell) |
| 子命令(status/plan/auth)跑了却像在跑 `run` | 服务的 entrypoint 是 `run-once.sh`,后面跟的命令被忽略 | 显式 `--entrypoint node` |
| **当天第一次真跑,退出码 1,企业微信里一条消息都没有** | `config.yaml` 以**文件**形式 bind mount 到容器里,而程序改配置的写法是「写 .tmp 再 rename 覆盖」—— rename 覆盖一个挂载点必然 EBUSY(2026-10-05 实测:1 秒内退出,`执行失败:EBUSY: resource busy or locked, rename '/opt/weread/config.yaml.tmp' -> '/opt/weread/config.yaml'`) | 挂成模板:`./weread/config.yaml:/opt/weread/config.template.yaml:ro`,由 `run-once.sh` 复制到容器可写层再用(补丁只影响本次运行,不需要落回宿主) |
| 崩溃时完全静默(只能靠"今天没消息"发现) | 程序死在发消息之前,result 消息根本没机会生成 | 两个运行器都加兜底:`alert-fail.mjs` —— 退出码非 0 **且**日志里从未出现「企业微信」时,补一条「需要你处理」提醒(出现过说明程序至少试过发送,不重复打扰) |

## 7.2 Epic 限免领取(2026-10-05 接入)

第三个程序,容器化时比前两个多两件事:**引擎刻意用可见窗口**(上游 `epic-games.js` 里写死
`headless: false`,注释说明 headless 更容易触发 hCaptcha)→ 容器里用 **Xvfb** 提供虚拟显示;
以及**结账环节的人机验证**只能人工完成(程序会把预置结账链接推给企业微信)。

| 项 | 值 |
| --- | --- |
| 镜像 | `automation-epic:local`(1.55 GB) |
| 容器 | `epic-run`,一次性;入口 `deploy/run-once.sh` 先起 Xvfb 再跑 `node src/cli.js run` |
| 编排位置 | 第三步(微软积分 → 微信读书 → Epic),宿主看门狗 `EPIC_RUN_TIMEOUT_MIN=40` |
| 浏览器 | 两个都预置:`chromium`(可见窗口用)+ `chromium-headless-shell`(注入 cookie 用 headless) |
| 凭据 | `epic/secrets/epic-tokens.json`(设备授权登录生成,自动续期)+ `wecom-webhook.txt` |
| 状态 | `epic/data/state.json`(已领记录、当天尝试次数);`epic/vendor-data/` 存上游引擎结果 |
| 守卫 | 程序自己判(src/guards.js):已暂停 / 次数用尽 / 同伴在跑 / 安静时段 / 内存不足 |

**接入时踩到的六个坑**(全在部署层,项目代码只改了两处):

| 症状 | 根因 | 修法 |
| --- | --- | --- |
| 构建直接失败 `"/vendor": not found` | 暂存布局与 Dockerfile 的 COPY 路径不一致 | 把项目摊平到构建上下文根(与 `COPY package.json/src/vendor` 对齐) |
| 构建日志里只有一行空的 `exit code: 1` | `read -r A B < <(node -e '...')`:node 输出不带换行 → `read` 返回 1 → `set -e` 静默退出 | 改用 herestring `read -r A B <<< "$(...)"`,并补参数校验 |
| `curl: command not found` | `node:24-slim` 里没有 curl,apt 清单漏了 | 加进 apt 清单 |
| `Executable doesn't exist at /root/.cache/ms-playwright/...` | 浏览器铺到了 `node_modules/patchright-core/.local-browsers`,但 patchright 默认去用户缓存找 | `ENV PLAYWRIGHT_BROWSERS_PATH=0` |
| 会话注入报 `Cannot read properties of undefined (reading '_playwright')` | 项目代码把 `chromium.launchPersistentContext` 拆下来单独调用,丢了 `this` | 项目侧修:`.bind(chromium)` |
| 引擎跑不起来、一直等到超时 | 上一次崩溃在 profile 里留下 `SingletonLock`,而容器每次都是新 hostname → Chromium 判成「被另一台电脑占用」 | `run-once.sh` 每次先 `rm -f /opt/epic/data/browser/Singleton*` |
| 引擎崩溃 `ENOENT .../vendor/free-games-claimer/data/.epic-games.json.tmp` | 镜像里没有那个 data 目录 | Dockerfile `mkdir -p` + compose 挂 `epic/vendor-data` 留档 |

**已知会走到人工的环节**:结账时的 hCaptcha。程序识别到就把「需要你处理」+ 每款一条结账链接推出来,
点开在浏览器里完成即可。2026-10-05 首次真跑就撞上了它(引擎日志:`Got hcaptcha challenge! Lost trust due to
too many login attempts?`),属于设计内的退化路径,不是故障。

## 7.3 2026-10-05 的两处行为调整

| 症状 / 诉求 | 原来 | 现在 |
| --- | --- | --- |
| 微信读书官方进度差一点就停了,只能等下一次触发 | 一次运行 = 一个底座会话,不达标只记一次尝试 | **会话循环**:不达标就在同一次运行内再跑一个会话(最多 3 个),每轮按最新官方进度重算目标并写回底座配置;宿主看门狗 100 → **330 分钟**;程序侧 `MAX_SESSIONS_PER_RUN=3`、`RUN_BUDGET_MINUTES=330` |
| Epic 消息里的预置结账链接打开报 `Account id is missing` | 消息只给 `.../store/purchase?offers=1-...` | 消息改推**商店页链接**(点 Get);预置结账链接仍可用 `node src/cli.js link` 取 |
| Epic 人机验证频繁出现 | 每天 2 次尝试 | 每天 **1 次**、失败不重试 —— 验证码多由"登录尝试过多"触发,保持上游"不刷"的定调 |
| 无可领取游戏时不想收到消息 | `nothing-new` 本来就不推送 | 加回归测试固化,防止以后改坏 |

微信读书的 `attempts` 现在按**会话**累加(一次触发内可能 2-3 个),每日上限 3 → 6;
循环结束后用 `recordMinutes()` 补记最终进度,**不**重复累加 attempts。

## 7.4 服务器侧体检容器(2026-10-05)

仓库里的「基础模块」(`scripts/` + `scripts/lib/`)多数是给 Windows 本机用的;真正在服务器上有价值的是
四个纯 Node 脚本(零 npm 依赖):`check-wecom-drift.mjs`、`check-privacy.mjs`、`apply-schedule.mjs --emit=systemd`、
`backup.mjs`。它们被放进**一个按需跑的容器**(compose 服务 `suite-check`,镜像 `automation-suite-check:local`),
宿主上什么都不用装,平时零进程 —— 更新工具只要在宿主的仓库克隆里 `git pull`,不必重建镜像。

```bash
gh repo clone Zzz210s/scripts-hub ~/scripts-hub   # 只做一次
suite-check            # 四项全跑;也可 drift|privacy|units|backup 单跑
```

服务器侧备份清单:`config/backup.server.json`(本地那份的 sets 是 Windows 路径)。restic 已装进镜像但
仓库/密码故意留空 —— `--apply` 会拒绝执行,现在只做 `--dry-run` 盘点(18/18 个来源、720 个文件、169MB)。

首次跑抓到两件真事:demo 脚本里写着真实账号昵称(已脱敏,注意它在公开仓库的**历史**里);
`/etc/systemd/system/` 的 unit 比仓库权威版旧(已按 `scripts/linux/systemd/` 重装)。

## 7.5 容器与磁盘的日常维护(2026-10-05)

**该清的只有构建缓存**。`docker system df` 会把"没有正在运行的容器在用"的镜像算进 `RECLAIMABLE` ——
这台上三个自动化镜像都是**一次性容器用完即退**,照那个数字跑 `docker image prune -a` 会把它们全删掉。
真正可回收的是构建缓存(反复重建攒下来的):

```bash
docker system df                       # 先看:Build Cache 的 Reclaimable 才是可清的
docker builder prune -f                # 清(不影响镜像,只让下次重建慢一点)
```

2026-10-05 实测:构建缓存 9.46GB(可回收 6.59GB)→ 清掉后根分区 21G→16G(37%→28%)。

**swap 已加到 4GB**(`/swap.img` 2G + `/swap2.img` 2G,后者 `pri=10`,都写进 `/etc/fstab`)。
加第二个文件而不是扩容第一个:当时只有 ~390MB 可用内存,`swapoff` 会把在用的 1.5GB 换页挤回内存,
大概率 OOM。跑批时的峰值内存 1.6-2.6GB,多一档 swap 是保险。

**内存水位与自动化无关**:这台上常驻的是 `singbox-relay`(1.6 MiB)与三个一次性容器;把可用内存吃掉的
是 VS Code 远端与 pi 会话(约 2.7GB)。今早 08:00 微软积分开跑时实测 `free 2806MB`、`clusters=2`。

**`suite-check resources`** 会在宿主上打一份水位(镜像/构建缓存/内存/swap/根分区),只在真该清时提示。

## 7.6 宿主调优(2026-10-05)

先量后调:24 小时均值 `%idle 86.2`、磁盘 `%util 6.3` —— 这台机器平时很闲,尖峰来自 VS Code 的全盘
搜索与后台构建,不是自动化。所以只做了"隔离与保护",没有堆监控。

| 项 | 改前 | 改后 | 位置 |
| --- | --- | --- | --- |
| `vm.swappiness` | 60 | **20** | `/etc/sysctl.d/99-automation-tuning.conf` |
| `net.ipv4.tcp_fastopen` | 1(仅客户端) | **3**(含服务端) | 同上 |
| `net.ipv4.tcp_max_syn_backlog` | 256 | **1024** | 同上 |
| 根分区挂载 | `relatime` | **`noatime`** | `/etc/fstab`(备份 `.bak-20261005`) |
| 拥塞控制 | cubic | **bbr**(先 `modprobe tcp_bbr` 确认内核支持) | `/etc/sysctl.d/99-bbr.conf` + `/etc/modules-load.d/bbr.conf` |
| 队列规则 | fq_codel | **fq** | 同上 |
| OOM 保护 | **无** | **earlyoom**(mem<5% 且 swap<5% 才动手;avoid sshd/systemd/dockerd/containerd,prefer code/node/chrome) | `/etc/default/earlyoom` |
| 自动化优先级 | `Nice=5`(比后台任务还低) | **`Nice=0` + CPUWeight/IOWeight=200** | `automation-suite.service.d/10-priority.conf` |
| 后台构建优先级 | `Nice=0`、无限制 | **`Nice=10` + IOSchedulingClass=idle + IO/CPUWeight=50 + MemoryMax=1G** | `blog-rebuild.service.d/10-priority.conf`(drop-in,不动原 unit) |
| Docker 日志 | `10m×3` | 加 **`compress: true`** | `/etc/docker/daemon.json`(备份 `.bak-20261005`) |
| 容器资源上限 | 无 | relay **256m/0.5cpu**、blog **512m/0.5cpu** | 各自 `compose.yaml` + 运行中 `docker update` |
| VS Code 搜索/监听排除 | 7 条 | **19 条**(`/usr` `/var` `/opt` `/snap` `/boot` `/tmp` `node_modules` `.next` `.cache` `.vscode-server` …) | `~/.vscode-server/data/Machine/settings.json`(备份 `.bak-20261005c`) |

两条实测踩坑记下来:

- 改 `/etc/fstab` 的 sed 把选项写进了**文件系统类型**字段(`/ ext4,noatime defaults 0 1`),`findmnt --verify`
  能查出来。改 fstab 一律先备份再 `findmnt --verify`。
- `EARLYOOM_ARGS` 里的引号在 heredoc 里写成了 `'` 字面量,earlyoom 只解析到 `-r 3600`(其余参数全丢)。
  写完要看 `/proc/<pid>/cmdline` 确认。

BBR 生效的验证:`ss -tin state established` 里能看到用 `bbr` 的连接;注意**入向**连接显示的是对端的算法,
要看本机作发送方的那条。

## 7.7 VS Code 远端服务的内存(2026-10-05 实测)

这台上真正吃内存的是**编辑器的扩展宿主**,不是自动化:

| 进程 | 实测 |
| --- | --- |
| 扩展宿主(`VSCODE_EXTHOST_WILL_SEND_SOCKET=1`) | **1.78 GB RSS + 2.59 GB swap**,14 线程;两小时内从 1.34 GB 长到 1.78 GB |
| VS Code 全部 13 个进程 | 合计 1765 MB RSS |
| 用户 slice(`user-1000.slice`) | ~2.15 GB(编辑器 + pi + shell) |
| 自动化 | 常驻 0(一次性容器);跑批峰值 1.6-2.6 GB |

远端只装了 2 个扩展(containers + 中文包),没有 TS 语言服务 —— 所以 1.78 GB 属于**累积**而不是某个扩展本身。

**内存账算不平**:跑批峰值 2.6 GB + 编辑器 2.1 GB + 系统 0.5 GB = 5.2 GB,而机器只有 3.7 GB。所以
微软积分运行器自带的内存闸门(`REWARDS_MIN_FREE_MB=1200`)才是实际的保护 —— 编辑器占着内存时,那次跑批会
**跳过**(当天还有 12:00 兜底与 `Persistent=true` 补跑)。今早 08:00 实测 `free 2806MB`,闸门没拦。

已做的两件事:

1. `user-1000.slice` 加 `MemoryHigh=2G`(`/etc/systemd/system/user-1000.slice.d/10-memory.conf`):
   超了就压它(回收/放慢),不杀进程。自动化是 **system** 服务,不在这个 slice 里,不受影响。
   写入时该 slice 已到 2.15 GB —— 正好卡在上限。
2. 远端 settings 关掉后台churn:`telemetry.telemetryLevel=off`、`extensions.autoUpdate/autoCheckUpdates=false`、
   `remote.autoForwardPorts=false`、`update.mode=none`;搜索/监听排除 19 条(见 7.6)。

其余可选项:重启远端服务(`Remote-SSH: Kill VS Code Server on Host`,立即回收 ~1.8 GB,窗口会重连)、
不用时禁用 containers 扩展(它在轮询 docker socket)、收窄工作区根(现在是 `/`,排除项只是缓解)、
试 `NODE_OPTIONS=--max-old-space-size=1024`(需实测远端服务是否尊重它)。

## 7.8 三端同步:本机 ↔ GitHub ↔ 服务器(2026-10-05)

真源是 GitHub `Zzz210s/note`(分支 `master`),两端都按"远端为主"同步。

| 端 | 触发 | 脚本 | 动作 |
| --- | --- | --- | --- |
| 本机 `F: -Note` | Windows 计划任务 `NoteSync`,每 5 分钟 | `scripts/note-sync/note-sync.sh` | pull --rebase --autostash → **只提交 2 分钟没被改过的文件** → 脱敏闸门 → 提交 → push(重试 3 次) |
| 服务器 `/srv/apps/note/repo` | systemd `note-sync.timer`,每 5 分钟 | `/srv/apps/automation/note-sync.sh` | 同上;拉取成功后博客重建按 sha 变化自动重建 |

配置:本机 `~/.note-sync/config.env`;服务器复用 `suite.env`。冲突一律**停下 + 企业微信通知**,绝不 force。

四个坑(都实测踩过):

1. **`git commit` 默认提交整个索引** —— 脚本判定"刚被改过"而跳过的文件,仍被别的会话暂存着,于是被一起提交。
   必须 `git commit -m ... -- "${READY[@]}"`,失败回滚也只用 `git reset -- "${READY[@]}"`。
2. **未跟踪同名文件挡住 merge** —— 另一个会话在服务器上新建了 `app_static.py`,远端也有同名文件,
   git 直接 `Aborting`。脚本现在拉取前把这些文件**移到备份目录**(不是删除)再拉。
3. **github 在这台机器上时通时断** —— 只用 `timeout` 不够(它杀的是直接子进程,`git fetch` 子进程会活下来),
   必须同时用 git 自己的低速超时:`git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30`。
4. **HTTPS + gh 凭据会把 token 放进 URL** —— `ps` 与 journald 里能看到
   `https://x-access-token:gho_***@github.com/...`。服务器侧已改为 **deploy key + SSH**
   (`~/.ssh/id_ed25519_note`,仓库 deploy key `server-note-sync`,写权限;`core.sshCommand` 指定密钥)。

## 7.9 一次真实事故:VS Code 扩展宿主吃满 swap(22:40–23:02)

**现象**:ping 通(8ms)、22/443 端口开、relay 正常返回 200,但 SSH **认证**卡死登不上;load 39(2 核),
swap 4095/4095 全满。

**根因**:VS Code 远端**扩展宿主**一个进程占 **3.45 GB swap**(另有 1.1 GB RSS)—— 编辑器把交换空间吃干净了。

**earlyoom 为什么没救**:它的判据是"内存**与** swap 同时低于阈值"(AND)。当时 swap 剩 0%,但内存还有 40%,
所以不触发。

**处理**:

| 动作 | 说明 |
| --- | --- |
| 撤掉 `user-1000.slice` 的 `MemoryHigh=2G` | 它只是加剧了压力(不是唯一原因),撤掉后恢复 `infinity` |
| 新增 `mem-guard`(每 5 分钟) | swap 剩余 <10% **且** load > 2×核数 → 杀掉 `vscode-server` 里 RSS 最大的进程并通知;**绝不碰 pi/tmux** |
| 装 `zram-tools`(lz4,25%,pri=100) | 换页走压缩内存,thrash 不再致命 |

**结果**:swap 4095 → 500 MB,可用内存 1131 → 2438 MB,load 39 → 8。

**教训**:小内存机器上"编辑器 + 跑批"共存,必须有基于 **swap/负载** 的守卫;earlyoom 的 AND 判据覆盖不了
"swap 满了但内存还没到底"。另外:VS Code 扩展宿主会**累积**(实测两小时 1.34 → 1.78 GB),
长期开着远端窗口就会走到这一步 —— 不用时关窗口,或定期重启远端服务。

## 7.10 企业微信消息通道(2026-10-05 拆分)

每个程序/用途一条独立通道,key 只落在服务器上的文件里(仓库外,600),文档只记路径。

| 通道 | 用途 | 文件 |
| --- | --- | --- |
| **Epic 限免** | 领取开始 / 结果 / 需要你处理 | `/srv/apps/automation/epic/secrets/wecom-webhook.txt` |
| **服务器** | 基础设施告警:内存守卫、note 同步冲突、部署与体检异常 | `/srv/apps/automation/secrets/wecom-server.txt` |
| 微软积分 | 不变 | `/srv/apps/automation/rewards/wechat-bridge/data/wecom-webhook.txt` |
| 微信读书签到 | 不变 | `/srv/apps/automation/weread/secrets/wecom-webhook.txt` |

本机侧的 0-Note 同步失败通知也走"服务器"通道(本机文件 `~/.note-sync/wecom-server.txt`)。

改通道只需换文件内容,不用动代码:`mem-guard.sh` 用 `MEM_GUARD_WEBHOOK`、`note-sync.sh` 用
`NOTE_WECOM_WEBHOOK`、`alert-fail.mjs` 用内置的"程序 → 文件"表(含 `服务器` 这一项,可被别的脚本复用)。

> 提醒:webhook key 属于凭据。仓库是公开的,任何把 key 写进笔记/文档的动作都会被 push 前的脱敏闸门拦下
> (规则名「企业微信 webhook 真 key」)。

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
