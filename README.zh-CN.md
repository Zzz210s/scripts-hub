# scripts-hub

[English](README.md) | **简体中文**

三个 Windows 无人值守自动化程序的配置、运行器脚本与说明:**微软积分**、**智慧树刷课**(Autovisor)、
**微信读书签到**。一个程序一个文件夹。

这里不是装完就能跑的程序。程序本体来自各自的上游项目、单独安装;本仓库放的是它们在本机怎么配、
怎么被调度、怎么通知、换机后怎么恢复。内容已脱敏,不含任何真实凭据。

## 30 秒地图

```
scripts-hub/
├── microsoft-rewards/   微软积分:配置、Windows 运行器、企业微信通知层
├── autovisor/           智慧树刷课:只有 Autovisor 的配置
├── weread-signin/       微信读书签到:程序本体(自动生成的快照,不要直接改这里)
├── wecom-notify/        通用的企业微信群机器人通知 CLI 与库(零依赖)
├── docs/                跨项目约定与总览 —— 先看 docs/README.md
├── machine/             本机部署现状:计划任务、本机目录,换机恢复时对照
├── patches/             所有上游补丁,按上游项目分目录
├── scripts/             开通与同步向导 —— 见 scripts/README.md
├── LICENSE              仓库整体 GPL-3.0;weread-signin/ 与 wecom-notify/ 内为 MIT
└── README.md / README.zh-CN.md
```

## 三个程序

| 程序 | 干什么 | 代码在哪 | 跑在哪台机器 | 什么时候跑 | 怎么通知 |
| --- | --- | --- | --- | --- | --- |
| **微软积分** | 每天跑 Microsoft Rewards(搜索、活动、读文章),算完分推送结果 | 上游 [`TheNetsky/Microsoft-Rewards-Script`](https://github.com/TheNetsky/Microsoft-Rewards-Script) v4.3.2,装在 `%REWARDS_DIR%`;本仓放 `microsoft-rewards/`(配置 + 运行器)与 `patches/microsoft-rewards/` | 本机 Windows | 任务 `MicrosoftRewardsScript`:登录后 3 分钟(其后 1 小时内每 10 分钟重试)+ 08:00 起每 2 小时一次、14 小时窗口;一天最多 3 次尝试 | 企业微信群机器人,发送层在 `microsoft-rewards/wechat-bridge/` |
| **智慧树刷课** | Autovisor 自动播放智慧树 / 知到的课程视频 | 上游 [`CXRunfree/Autovisor`](https://github.com/CXRunfree/Autovisor) v3.17.3,装在 `%AUTOVISOR_DIR%`;本仓放 `autovisor/configs.ini` | 本机 Windows(需要 Chrome 与图形会话) | 手动跑 `Autovisor.exe`,没有计划任务 | 不接通知,只有程序自己的界面与日志 |
| **微信读书签到** | 每天完成微信读书阅读挑战,再用官方只读 API 回读校验时长真被计入 | 底座 [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot);代码本体在本仓 `weread-signin/`(由本机开发克隆 `%WEREAD_DIR%` 自动生成的快照) | 本机 Windows | 任务 `WeReadSignIn`:登录后 10 分钟(1 小时内每 10 分钟重试)+ 08:30 起每 60 分钟一次、14 小时窗口 | 企业微信群机器人,发送层在 `weread-signin/src/notify.js` |

另有一条不属于「程序」的计划任务:`AutoShutdown0200` 每天 02:00 无条件关机
(`microsoft-rewards/scripts-windows/auto-shutdown.bat`)。各程序用自己的安装脚本注册任务。

**云迁移还没做。** 上面这些现在全跑在这一台 Windows 机器上。把微软积分与微信读书签到搬到
Oracle Cloud 永久免费 ARM 主机已经设计并写进文档(`docs/cloud-vm.md`、`docs/scheduling-convention.md`
的云端一节),但卡在 Oracle 注册风控,目前还没有云主机。

## 快速开始

想用其中一个程序:进它自己的文件夹,读那个文件夹的 README —— 程序本体从上游装,文件夹里写清
要复制哪些配置与脚本到哪里。

想在新机器上把整套搭起来:

1. 克隆本仓库。
2. 先读 `docs/README.md` 了解约定,再读 `docs/automation-overview.md` 看全貌。
3. 从上游安装三个程序本体,按各程序的 README 把本仓库的配置与运行器脚本覆盖进程序目录。
4. 按 `docs/credentials.md` 填真实凭据。
5. 注册计划任务;任务名与命令见 `machine/scheduled-tasks.md`。

云主机(尚未开通):先跑 `scripts/oracle-setup-wizard.sh`,再读 `docs/cloud-vm.md`。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [`docs/README.md`](docs/README.md) | 全部文档的索引 |
| [`docs/automation-overview.md`](docs/automation-overview.md) | 全貌:程序、代码、机器、调度、仓库 |
| [`docs/scheduling-convention.md`](docs/scheduling-convention.md) | 错峰槽位与两段守卫,本机与规划中的云主机两版 |
| [`docs/notification-convention.md`](docs/notification-convention.md) | 四种企业微信消息类型与文案硬规则 |
| [`docs/cloud-vm.md`](docs/cloud-vm.md) | 为什么要云主机、哪些方案被否定 |
| [`docs/credentials.md`](docs/credentials.md) | 哪个文件要填什么、去哪拿、失效后怎么恢复 |
| [`machine/scheduled-tasks.md`](machine/scheduled-tasks.md) | 本机计划任务清单,以及查看与停用命令 |
| [`scripts/README.md`](scripts/README.md) | 三个向导各自做什么 |

## 路径约定

文档不写死任何盘符。三个占位符指程序本体的安装目录,**按你的实际路径替换**:

| 占位符 | 指什么 |
| --- | --- |
| `%REWARDS_DIR%` | 微软积分程序本体的根目录(解压上游 release 后的目录) |
| `%AUTOVISOR_DIR%` | Autovisor 安装目录(其下有 `app\`) |
| `%WEREAD_DIR%` | 微信读书的开发克隆 —— 一个本地 git 克隆,它的已跟踪文件由 `scripts/sync-weread-signin.sh` 发布成 `weread-signin/` |

运行器脚本都用 `%~dp0` 相对定位,整个目录可以原样挪到任何路径。必须留在本机、不入库的路径写在
私有文件 `~/.config/automation-suite/local-paths.env`(在仓库之外);那里的 `automation-suite`
是历史遗留的本机目录名,与任何 git 仓库无关。

## 许可与来源

仓库整体按 **GPL-3.0** 授权(见 `LICENSE`),因为其中一部分是 GPL-3.0 上游的衍生作品:
微软积分的补丁是针对上游 TypeScript 源码的 diff,`microsoft-rewards/env.example` 是上游原版文件,
`microsoft-rewards/config.json` 由上游配置改写而来。

两个子目录是 **MIT**,各自保留 `LICENSE`:`weread-signin/`(继承自底座 `funnyzak/weread-bot`)
与 `wecom-notify/`(本项目自研,原独立私有仓库 `Zzz210s/wecom-notify`)。`autovisor/configs.ini`
同样来自 MIT 上游。MIT 与 GPL-3.0 单向兼容,所以它们能放进本仓库,内部文件仍按 MIT。

`patches/weread-bot/` 记录一个有意保留的 fork,用来向上游提交修复,不属于本仓库的合并范围;
为什么在 PR #53 关闭前不能删,见该目录的 README。
