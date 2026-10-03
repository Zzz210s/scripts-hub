# home-automation-configs

[English](README.md) | **简体中文**

一个公开仓库,装三个 Windows 自动化程序(微软积分 / 智慧树刷课 / 微信读书签到)的配置、运行器
脚本、部署向导与换机恢复说明 —— **每个项目一个文件夹**。

程序本体来自上游项目、各自单独安装;这里放的是它们在本机的配置、无人值守调度层、企业微信通知层、
部署与同步脚本,以及一份「换机后怎么恢复」的说明。**它不是装完就能跑的程序**。仓库内容已脱敏,
不含任何真实凭据。

整体索引见 `docs/automation-overview.md`:每个程序是什么、代码在哪、跑在哪台机器、怎么被调度与通知。

## 目录

- [目录结构](#目录结构)
- [三个程序](#三个程序)
- [部署与维护脚本](#部署与维护脚本)
- [路径约定](#路径约定)
- [微信读书代码快照](#微信读书代码快照)
- [通用约定](#通用约定)
- [换机恢复](#换机恢复)
- [凭据](#凭据)
- [许可与来源](#许可与来源)

## 目录结构

| 路径 | 是什么 |
| --- | --- |
| `docs/` | 跨项目的说明:自动化全貌(索引)、为什么上云、云端调度约定、通知约定 |
| `scripts/` | 部署/开通向导(Oracle Cloud、删库重建、微信读书快照同步),以及两个保留备查的组织迁移脚本 |
| `microsoft-rewards/` | 配置快照、Windows 运行器脚本、企业微信通知层、上游补丁存档 |
| `autovisor/` | 智慧树配置(课程链接,**不含账号密码**) |
| `weread-signin/` | 权威微信读书仓库的**完整代码快照**(见下文) |
| `tasks/` | 本机计划任务清单 + 错峰/通知/守卫约定 |
| `secrets/README.md` | 凭据清单(哪个文件要填什么、去哪拿;不写值) |

## 三个程序

| 程序 | 作用 | 程序本体 | 配置在本仓库的位置 |
| --- | --- | --- | --- |
| **微软积分** | 每天自动跑 Microsoft Rewards(搜索、活动、读文章),算完分推送到企业微信 | 上游 [`TheNetsky/Microsoft-Rewards-Script`](https://github.com/TheNetsky/Microsoft-Rewards-Script) v4.3.2 + 本仓库补丁,装在 `%REWARDS_DIR%` | `microsoft-rewards/` |
| **智慧树刷课** | Autovisor,自动播放智慧树/知到的网课视频 | 上游 [`CXRunfree/Autovisor`](https://github.com/CXRunfree/Autovisor) v3.17.3,装在 `%AUTOVISOR_DIR%` | `autovisor/` |
| **微信读书签到** | 每天自动完成微信读书阅读挑战的打卡(读满当日所需时长),再用官方只读 API 回读校验 | 权威仓库 [`Zzz210s/weread-signin`](https://github.com/Zzz210s/weread-signin)(底座 [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot)),克隆在 `%WEREAD_DIR%` | `weread-signin/`(代码快照) |

另有一条不属于「程序」的计划任务:每天 02:00 无条件关机的 `AutoShutdown0200`(脚本在
`microsoft-rewards/scripts-windows/auto-shutdown.bat`);各程序另有自己的任务注册脚本。

## 部署与维护脚本

| 脚本 | 作用 |
| --- | --- |
| `scripts/oracle-setup-wizard.sh` | 一步步注册并开通 Oracle Cloud 永久免费 ARM 主机、放行两层防火墙、写 SSH 配置并验证连通 |
| `scripts/public-reset-wizard.sh` | 删库重建 `home-automation-configs`(只有删库重建才真正清掉旧对象),把已只读的 `Zzz210s/weread-signin` 归档,再复核推送后的历史 |
| `scripts/sync-weread-signin.sh` | 从权威克隆刷新 `weread-signin/` 快照,只复制 `git ls-files` 列出的文件(支持 `--dry-run`) |
| `scripts/github-org-wizard.sh`、`scripts/transfer-repos.sh` | 来自已放弃的「把仓库迁进 GitHub 组织」方案,保留备查,平时不需要跑 |

机器相关路径不写死:脚本默认读 `~/.config/automation-suite/local-paths.env`(在本仓库之外,永不入库),
也支持环境变量覆盖(`WEREAD_SIGNIN_DIR`、`HOME_AUTOMATION_CONFIGS_DIR` 等)。

## 路径约定

文档里用三个占位符代指程序本体的安装目录,**按你的实际路径替换**(仓库不绑定任何盘符):

| 占位符 | 指什么 |
| --- | --- |
| `%REWARDS_DIR%` | 微软积分程序本体的根目录(解压上游 release 后所在目录) |
| `%AUTOVISOR_DIR%` | Autovisor 的安装目录(其下有 `app\`) |
| `%WEREAD_DIR%` | `Zzz210s/weread-signin` 的克隆目录 |

本仓库的微软积分运行器脚本都用 `%~dp0` 相对定位,不写死盘符,所以整个目录可以原样挪到任何路径。

## 微信读书代码快照

微信读书的代码**故意存两份**:权威仓库
[`Zzz210s/weread-signin`](https://github.com/Zzz210s/weread-signin)(现已归档、只读)和本仓库的
`weread-signin/`。

- **权威来源**:`Zzz210s/weread-signin` 以及它的本地开发克隆 `%WEREAD_DIR%`;开发在那里做。
- **本目录是快照**:内容取自该仓库的已跟踪文件,取快照时的提交记在 `weread-signin/SNAPSHOT.txt`。
- **同步方式**:`bash scripts/sync-weread-signin.sh` 从权威克隆复制 `git ls-files` 列出的文件,并重写
  `weread-signin/README.md` 与 `README.zh-CN.md` 顶部的快照说明。不要直接改快照里的文件,下次同步会覆盖。
- `weread-signin/LOCAL-DEPLOYMENT.md` 是本仓库手写的本机运行说明,不参与同步。

## 通用约定

- **真实凭据永不入库**:`.env`、cookie、webhook、API Key 只留在各程序自己的目录里;本仓库只有模板和说明(`.gitignore` 已排除)。
- **调度统一**:Windows 计划任务 + 隐藏窗口启动器(`wscript` 调 `.vbs`)+ 单实例锁 + 一天一次守卫 + 失败重试 + 看门狗超时强杀。云端版改用 systemd timer(见 `docs/cloud-scheduling-convention.md`)。
- **错峰**:每个程序占一个 30 分钟槽位、登录延迟按 7 分钟步进,运行前先查同伴的锁文件,任一在跑就跳过本次(见 `tasks/scheduling-convention.md`)。
- **通知统一**:企业微信群机器人 webhook;消息类型与文案硬规则固定在 `docs/notification-convention.md`。
- **运行数据统一**:状态与日志写在各程序目录的 `logs/`、`data/`、`sessions/`,不入库。

## 换机恢复

本仓库同时是一份恢复包。大致顺序:

1. 克隆本仓库
2. 装程序本体:微软积分解压上游 release 到 `%REWARDS_DIR%`;Autovisor 解压到 `%AUTOVISOR_DIR%`;微信读书放到 `%WEREAD_DIR%` —— 克隆 `Zzz210s/weread-signin`,或直接用本仓库的 `weread-signin/` 快照
3. 把本仓库的模板/脚本覆盖进各程序目录:微软积分用 `microsoft-rewards/` 下的 `config.json`、`scripts-windows/`、`wechat-bridge/`、`patches/`(升级上游后按序 `git apply`)
4. 按 `secrets/README.md` 填真实凭据
5. 注册计划任务:微软积分跑 `%REWARDS_DIR%\scripts\windows\install-autostart.bat`;微信读书跑代码里的 `scripts\windows\install-autostart.ps1`
6. 用 `tasks/inventory.md` 里的命令核对任务状态

云主机:先用 `scripts/oracle-setup-wizard.sh` 开通,再按 `docs/cloud-vm.md` 与
`docs/cloud-scheduling-convention.md` 装调度。

## 凭据

见 `secrets/README.md`:那里逐个列出哪个文件要填什么、去哪里拿。**仓库里没有任何真实值**(可以在历史里自查:所有 `.env`、cookie、webhook 从未被提交过)。

## 许可与来源

仓库整体按 **GPL-3.0** 授权(见 `LICENSE`)。选它的原因:本仓库分发的部分内容是 GPL-3.0 上游的衍生作品 —— 微软积分的补丁是直接针对上游 TypeScript 源码的 diff,`env.example` 是上游原版,`config.json` 由上游配置改写而来。整体用 GPL-3.0 与上游一致,不会产生许可冲突。其余文件(运行器脚本、通知层、脚本、说明文档)按 GPL-3.0 一并分发。

**有一个子目录是 MIT,不是 GPL-3.0**:`weread-signin/` 是
[`Zzz210s/weread-signin`](https://github.com/Zzz210s/weread-signin) 的快照,那个仓库是 MIT 许可,
快照里保留它自己的 `LICENSE` 文件。MIT 与 GPL-3.0 单向兼容,所以这份快照可以放进 GPL-3.0 仓库一并分发;
`weread-signin/` 下的文件仍按原始 MIT 条款。`autovisor/configs.ini` 同理(来自 MIT 上游)。

内含的上游来源与许可:

| 本仓库路径 | 来源 | 许可 |
| --- | --- | --- |
| `microsoft-rewards/patches/*.patch` | 针对 [`TheNetsky/Microsoft-Rewards-Script`](https://github.com/TheNetsky/Microsoft-Rewards-Script) v4.3.2 源码的补丁 | GPL-3.0 |
| `microsoft-rewards/env.example` | 上游同名文件,原样保留 | GPL-3.0 |
| `microsoft-rewards/config.json` | 由上游配置示例改写 | GPL-3.0 |
| `microsoft-rewards/scripts-windows/`、`microsoft-rewards/wechat-bridge/` | 本项目自研(不来自上游) | GPL-3.0 |
| `autovisor/configs.ini` | [`CXRunfree/Autovisor`](https://github.com/CXRunfree/Autovisor) 的配置模板,填了本机取值 | MIT |
| `weread-signin/**` | [`Zzz210s/weread-signin`](https://github.com/Zzz210s/weread-signin) 的快照,其底座是 [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot) | MIT |
| `docs/`、`scripts/`、`tasks/`、`secrets/README.md`、两份 README | 本项目自研 | GPL-3.0 |
