# scripts-hub

[English](README.md) | **简体中文**

多个**相互隔离、各自完整**的项目合集:三个 Windows 无人值守自动化程序(**微软积分**、**智慧树刷课**
Autovisor、**微信读书签到**)加一个通用的企业微信通知库。一个项目一个文件夹,各自带 README、依赖
清单、测试与许可。

这里不是装完就能跑的程序。程序本体来自各自的上游项目、单独安装;本仓库放的是它们在本机怎么配、
怎么被调度、怎么通知、换机后怎么恢复。同时,它还是两个**没有 origin 的本地权威工作区**的远程落点:
`%REWARDS_DIR%`(微软积分)与 `%WEREAD_DIR%`(微信读书);代码改动怎么进仓库看
[`docs/workspace-model.md`](docs/workspace-model.md)。内容已脱敏,不含任何真实凭据。

## 30 秒地图

```
scripts-hub/
├── microsoft-rewards/   微软积分:完整项目(上游源码 + 本地补丁、运行器、通知层)
├── autovisor/           智慧树刷课:只有 Autovisor 配置(程序本体是上游 Windows 包)
├── weread-signin/       微信读书签到:程序本体(自动生成的快照,不要直接改这里)
├── wecom-notify/        通用的企业微信群机器人通知 CLI 与库(零依赖)
├── docs/                跨项目约定与总览 —— 先看 docs/README.md
├── machine/             本机部署现状:计划任务、本机目录,换机恢复时对照
├── patches/             所有上游补丁,按上游项目分目录
├── scripts/             开通、同步与漂移检测工具 —— 见 scripts/README.md
├── LICENSE              仓库整体 GPL-3.0;weread-signin/ 与 wecom-notify/ 内为 MIT
└── README.md / README.zh-CN.md
```

## 三个程序

| 程序 | 干什么 | 在哪 |
| --- | --- | --- |
| **微软积分** | 每天跑 Microsoft Rewards(搜索、活动、读文章),算完分推送结果。 | `microsoft-rewards/` |
| **智慧树刷课** | Autovisor 自动播放智慧树 / 知到的课程视频。 | `autovisor/` |
| **微信读书签到** | 每天完成微信读书阅读挑战,再用官方只读 API 回读校验时长真被计入。 | `weread-signin/` |

另有一条不属于「程序」的计划任务:`AutoShutdown0200` 每天 02:00 无条件关机。代码来源、安装路径、
跑在哪台机器、调度、通知方式、凭据、云迁移现状、路径约定与许可细节,全都在
[`docs/automation-overview.md`](docs/automation-overview.md)。

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
| [`docs/workspace-model.md`](docs/workspace-model.md) | 各项目的权威工作区在哪、改了代码怎么进仓库、为什么不用 submodule |
| [`docs/automation-overview.md`](docs/automation-overview.md) | 全貌:程序、代码、机器、调度、仓库、路径约定、许可与来源 |
| [`docs/scheduling-convention.md`](docs/scheduling-convention.md) | 错峰槽位与两段守卫,本机与规划中的云主机两版 |
| [`docs/notification-convention.md`](docs/notification-convention.md) | 四种企业微信消息类型与文案硬规则 |
| [`docs/cloud-vm.md`](docs/cloud-vm.md) | 为什么要云主机、哪些方案被否定 |
| [`docs/credentials.md`](docs/credentials.md) | 哪个文件要填什么、去哪拿、失效后怎么恢复 |
| [`machine/scheduled-tasks.md`](machine/scheduled-tasks.md) | 本机计划任务清单,以及查看与停用命令 |
| [`scripts/README.md`](scripts/README.md) | 三个向导、两个快照同步与企业微信漂移检测 |
