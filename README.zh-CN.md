# home-automation-configs

[English](README.md) | **简体中文**

三个 Windows 自动化程序(微软积分 / 智慧树刷课 / 微信读书签到)的配置、调度脚本与换机恢复说明。

本仓库**不是可运行的软件**:程序本体来自上游项目,各自装在自己的目录里;这里放的是它们在本机的配置、无人值守调度脚本、企业微信通知层,以及一份「换机后怎么恢复」的说明。仓库内容已脱敏,不含任何真实凭据。

## 目录

- [仓库里有什么](#仓库里有什么)
- [三个程序](#三个程序)
- [路径约定](#路径约定)
- [目录结构](#目录结构)
- [通用约定](#通用约定)
- [换机恢复](#换机恢复)
- [凭据](#凭据)
- [许可与来源](#许可与来源)

## 仓库里有什么

| 内容 | 位置 | 性质 |
| --- | --- | --- |
| 运行器脚本:守卫、单实例锁、看门狗、内存闸门、关机任务、任务注册 | `microsoft-rewards/scripts-windows/` | 本项目自研,可原样使用 |
| 企业微信通知层:开始 / 结束 / 跳过 / 当日合并汇总 / 低分归因 | `microsoft-rewards/wechat-bridge/` | 本项目自研 |
| 微软积分程序配置 | `microsoft-rewards/config.json`、`microsoft-rewards/env.example` | 实际配置 + 上游模板 |
| 上游源码补丁存档(升级上游后按序 `git apply`) | `microsoft-rewards/patches/` | 本项目自研补丁 |
| 智慧树刷课配置(课程链接,**不含账号密码**) | `autovisor/configs.ini` | 上游模板 + 本机取值 |
| 微信读书签到:本机部署说明 | `weread-signin/README.md` | 本项目自研(程序本体在另一个仓库) |
| 计划任务清单、错峰与通知约定 | `tasks/` | 本项目自研 |
| 凭据清单(只写「去哪拿」,不写值) | `secrets/README.md` | 本项目自研 |

## 三个程序

| 程序 | 作用 | 程序本体 | 配置在本仓库的位置 |
| --- | --- | --- | --- |
| **微软积分** | 每天自动跑 Microsoft Rewards(搜索、活动、读文章),算完分推送到企业微信 | 上游 [`TheNetsky/Microsoft-Rewards-Script`](https://github.com/TheNetsky/Microsoft-Rewards-Script) v4.3.2 + 本仓库补丁,装在 `%REWARDS_DIR%` | `microsoft-rewards/` |
| **智慧树刷课** | Autovisor,自动播放智慧树/知到的网课视频 | 上游 [`CXRunfree/Autovisor`](https://github.com/CXRunfree/Autovisor) v3.17.3,装在 `%AUTOVISOR_DIR%` | `autovisor/` |
| **微信读书签到** | 每天自动完成微信读书阅读挑战的打卡(读满当日所需时长),再用官方只读 API 回读校验 | [`Zzz210s/weread-signin`](https://github.com/Zzz210s/weread-signin)(底座 [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot)),装在 `%WEREAD_DIR%` | `weread-signin/` |

另有一条不属于「程序」的计划任务:每天 02:00 无条件关机的 `AutoShutdown0200`(脚本在 `microsoft-rewards/scripts-windows/auto-shutdown.bat`);各程序另有自己的任务注册脚本。

## 路径约定

文档里用三个占位符代指程序本体的安装目录,**按你的实际路径替换**(仓库不绑定任何盘符):

| 占位符 | 指什么 |
| --- | --- |
| `%REWARDS_DIR%` | 微软积分程序本体的根目录(解压上游 release 后所在目录) |
| `%AUTOVISOR_DIR%` | Autovisor 的安装目录(其下有 `app\`) |
| `%WEREAD_DIR%` | `Zzz210s/weread-signin` 的克隆目录 |

本仓库的微软积分运行器脚本都用 `%~dp0` 相对定位,不写死盘符,所以整个目录可以原样挪到任何路径。

## 目录结构

```
microsoft-rewards/    微软积分:config.json 快照、env.example、运行器脚本、补丁存档、企业微信通知层
autovisor/            智慧树:configs.ini(含课程链接,不含账号密码)
weread-signin/        微信读书:只放本机部署说明(程序与配置模板的权威来源是 Zzz210s/weread-signin)
tasks/                计划任务清单 + 错峰/通知/守卫的约定
secrets/              哪些值要填、去哪里拿(只写说明,不写值)
```

## 通用约定

- **真实凭据永不入库**:`.env`、cookie、webhook、API Key 只留在各程序自己的目录里;本仓库只有模板和说明(`.gitignore` 已排除)。
- **调度统一**:Windows 计划任务 + 隐藏窗口启动器(`wscript` 调 `.vbs`)+ 单实例锁 `logs/run.lock` + 一天一次守卫 + 失败重试 + 看门狗超时强杀。
- **错峰**:每个程序占一个 30 分钟槽位、登录延迟按 7 分钟步进,运行前先查同伴的锁文件,任一在跑就跳过本次(见 `tasks/scheduling-convention.md`)。
- **通知统一**:企业微信群机器人 webhook。
- **运行数据统一**:状态与日志写在各程序目录的 `logs/`、`data/`、`sessions/`,不入库。

## 换机恢复

本仓库同时是一份恢复包。大致顺序:

1. 克隆本仓库
2. 装程序本体:微软积分解压上游 release 到 `%REWARDS_DIR%`;Autovisor 解压到 `%AUTOVISOR_DIR%`;微信读书克隆 `Zzz210s/weread-signin` 到 `%WEREAD_DIR%`
3. 把本仓库的模板/脚本覆盖进各程序目录:微软积分用 `microsoft-rewards/` 下的 `config.json`、`scripts-windows/`、`wechat-bridge/`、`patches/`(升级上游后按序 `git apply`)
4. 按 `secrets/README.md` 填真实凭据
5. 注册计划任务:微软积分跑 `%REWARDS_DIR%\scripts\windows\install-autostart.bat`;微信读书跑权威仓库里的 `scripts\windows\install-autostart.ps1`
6. 用 `tasks/inventory.md` 里的命令核对任务状态

## 凭据

见 `secrets/README.md`:那里逐个列出哪个文件要填什么、去哪里拿。**仓库里没有任何真实值**(可以在历史里自查:所有 `.env`、cookie、webhook 从未被提交过)。

## 许可与来源

仓库整体按 **GPL-3.0** 授权(见 `LICENSE`)。选它的原因:本仓库分发的部分内容是 GPL-3.0 上游的衍生作品 —— 微软积分的补丁是直接针对上游 TypeScript 源码的 diff,`env.example` 是上游原版,`config.json` 由上游配置改写而来。整体用 GPL-3.0 与上游一致,不会产生许可冲突。其余文件(运行器脚本、通知层、说明文档)按 GPL-3.0 一并分发。

内含的上游来源与许可:

| 本仓库路径 | 来源 | 许可 |
| --- | --- | --- |
| `microsoft-rewards/patches/*.patch` | 针对 [`TheNetsky/Microsoft-Rewards-Script`](https://github.com/TheNetsky/Microsoft-Rewards-Script) v4.3.2 源码的补丁 | GPL-3.0 |
| `microsoft-rewards/env.example` | 上游同名文件,原样保留 | GPL-3.0 |
| `microsoft-rewards/config.json` | 由上游配置示例改写 | GPL-3.0 |
| `microsoft-rewards/scripts-windows/`、`microsoft-rewards/wechat-bridge/` | 本项目自研(不来自上游) | GPL-3.0 |
| `autovisor/configs.ini` | [`CXRunfree/Autovisor`](https://github.com/CXRunfree/Autovisor) 的配置模板,填了本机取值 | MIT |
| `weread-signin/README.md` | 本项目自研;程序本体与配置模板的权威来源是 [`Zzz210s/weread-signin`](https://github.com/Zzz210s/weread-signin),其底座 [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot) | 本文件 GPL-3.0;那两处的代码/模板为 MIT |
| `tasks/`、`secrets/README.md`、两份 README | 本项目自研 | GPL-3.0 |

MIT 许可的内容与 GPL-3.0 兼容,可以按 GPL-3.0 一并分发;上表里标注为 MIT 的文件仍保留其原始许可条款。
