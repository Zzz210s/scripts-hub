# scripts-hub

[English](README.md) | **简体中文**

多个**相互隔离、各自完整**的项目合集:三个 Windows 无人值守自动化程序(**微软积分**、**智慧树刷课**
Autovisor、**微信读书签到**)。一个项目一个文件夹,各自带 README、依赖清单、测试与许可。
各程序共用的企业微信通知规则见 [`docs/wecom-rules.md`](docs/wecom-rules.md);实现由各项目自己持有。

这里不是装完就能跑的程序。程序本体来自各自的上游项目、单独安装;本仓库放的是它们在本机怎么配、
怎么被调度、怎么通知、换机后怎么恢复。同时,它还是两个**没有 origin 的本地权威工作区**的远程落点:
`%REWARDS_DIR%`(微软积分)与 `%WEREAD_DIR%`(微信读书);代码改动怎么进仓库看
[`docs/workspace-model.md`](docs/workspace-model.md)。内容已脱敏,不含任何真实凭据。

> **快照只出不进。** `proj-microsoft-rewards/` 与 `proj-weread-signin/` 是两个本地工作区的**脱敏快照**
> (本机绝对路径 -> 占位符,个人标识 -> `sample`),**不是可回灌的部署件**:写回工作区会用占位符覆盖
> 真实值。刷新仓库走 `scripts/sync-*.sh`(工作区 -> 仓库);`scripts/deploy-*.sh` 只用于换机恢复,
> 对与快照同源的工作区默认拒绝覆盖,除非显式加 `--allow-authoritative`(先预览、再输入 yes 确认、自动备份)。

## 30 秒地图

```
scripts-hub/
├── proj-microsoft-rewards/   微软积分:完整项目(上游源码 + 本地补丁、运行器、通知层)
├── proj-autovisor/           智慧树刷课:只有 Autovisor 配置(程序本体是上游 Windows 包)
├── proj-weread-signin/       微信读书签到:程序本体(自动生成的快照,不要直接改这里)
├── docs/                     跨项目约定与总览 —— 先看 docs/README.md
├── config/                   schedule.json:各程序什么时候跑,生成计划任务/timer 的依据
├── patches/                  所有上游补丁,按上游项目分目录
├── scripts/                  开通、同步与漂移检测工具 —— 见 scripts/README.md
├── LICENSE                   仓库整体 GPL-3.0;proj-weread-signin/ 内为 MIT
└── README.md / README.zh-CN.md
```

## 三个程序

| 程序 | 干什么 | 在哪 |
| --- | --- | --- |
| **微软积分** | 每天跑 Microsoft Rewards(搜索、活动、读文章),算完分推送结果。 | `proj-microsoft-rewards/` |
| **智慧树刷课** | Autovisor 自动播放智慧树 / 知到的课程视频。 | `proj-autovisor/` |
| **微信读书签到** | 每天完成微信读书阅读挑战,再用官方只读 API 回读校验时长真被计入。 | `proj-weread-signin/` |

另有一条不属于「程序」的计划任务:`AutoShutdown0200` 每天 02:00 无条件关机。代码来源、安装路径、
跑在哪台机器、调度、通知方式、凭据、云迁移现状、路径约定与许可细节,全都在
[`docs/automation-overview.md`](docs/automation-overview.md)。

## 快速开始

想用其中一个程序:进它自己的文件夹,读 `QUICKSTART.md`(前置条件 / 三条命令 / 需要填的凭据 /
怎么验证跑通了 / 常见失败),再按 `README` 看细节。程序本体从上游装,文件夹里写清要复制哪些配置与
脚本到哪里。想让它自己检查一遍,跑 `bash scripts/setup-<项目名>.sh`(离线自检,不登录、不真跑)。

三个项目各自的最少步骤:

| 项目 | 全新克隆到能跑 |
| --- | --- |
| `proj-weread-signin/` | `npm test` + `node src/index.js status`;真跑要凭据与 Python 底座 |
| `proj-microsoft-rewards/` | `npm ci` + patchright chromium + `npm run build`;离线测试可跳过前两步 |
| `proj-autovisor/` | 无可执行代码,只有配置;程序本体从上游下载 |

想在新机器上把整套搭起来:

1. 克隆本仓库。
2. 先读 `docs/README.md` 了解约定,再读 `docs/automation-overview.md` 看全貌。
3. 从上游安装三个程序本体,按各程序的 README 把本仓库的配置与运行器脚本覆盖进程序目录。
4. 按 `docs/credentials.md` 填真实凭据。
5. 注册计划任务;任务名与命令见 `docs/local-deployment.md`。

云主机(尚未开通):先跑 `scripts/wizard-oracle.sh`,再读 `docs/cloud-vm.md`。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [`docs/README.md`](docs/README.md) | 全部文档的索引 |
| [`docs/workspace-model.md`](docs/workspace-model.md) | 各项目的权威工作区在哪、改了代码怎么进仓库、为什么不用 submodule |
| [`docs/automation-overview.md`](docs/automation-overview.md) | 全貌:程序、代码、机器、调度、仓库、路径约定、许可与来源 |
| [`docs/scheduling-convention.md`](docs/scheduling-convention.md) | 错峰槽位与两段守卫,本机与规划中的云主机两版 |
| [`docs/notification-convention.md`](docs/notification-convention.md) | 四种企业微信消息类型与文案硬规则 |
| [`docs/wecom-rules.md`](docs/wecom-rules.md) | 企业微信 webhook 的共享规则:字节上限、超时与重试、errcode 处理、发送频率 |
| [`docs/cloud-vm.md`](docs/cloud-vm.md) | 为什么要云主机、哪些方案被否定 |
| [`docs/credentials.md`](docs/credentials.md) | 哪个文件要填什么、去哪拿、失效后怎么恢复 |
| [`docs/local-deployment.md`](docs/local-deployment.md) | 本机部署现状:工作区、计划任务、运行器守卫、本机私有文件 |
| [`scripts/README.md`](scripts/README.md) | 向导、快照同步、项目自检引导与检查(企业微信漂移、隐私扫描) |
