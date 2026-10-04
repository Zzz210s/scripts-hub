# 自动脚本全貌

这台机器上「每天自己跑一次」的自动化程序:是什么、代码在哪、跑在哪台机器、怎么被调度、怎么通知、
凭据放哪。**本文是索引**,细节指向真源文件,不复制它们的正文。

- 所在仓库:`Zzz210s/scripts-hub`(公开;本机克隆目录名沿用 `home-automation-configs`)
- 内容核对时间:2026-10-04(计划任务状态、上游 PR/issue 状态均为当时实查)

## 0. 真源在哪(改东西先看这张表)

| 内容 | 真源 |
| --- | --- |
| 错峰槽位、两段守卫、单实例锁(本机与云端) | `docs/scheduling-convention.md` |
| 通知 4 类型、频率限制、文案硬规则 | `docs/notification-convention.md` |
| 为什么考虑云主机、卡在哪 | `docs/cloud-vm.md` |
| 每个凭据去哪拿、有效期、失效后怎么恢复 | `docs/credentials.md` |
| 本机计划任务清单与停用命令 | `machine/scheduled-tasks.md` |
| 本机微信读书部署现状 | `machine/weread-deployment.md` |
| 微软积分运行器、通知层与源码改动 | 权威工作区 `%REWARDS_DIR%`(本地 git 仓库,只有 upstream 远端);已跟踪文件由 `scripts/sync-microsoft-rewards.sh` 发布成 `microsoft-rewards/`(完整快照) |
| 微信读书签到程序 | 代码本体就在本仓库 `weread-signin/`;开发在本地克隆 `%WEREAD_DIR%`,用 `scripts/sync-weread-signin.sh` 发布 |
| 智慧树刷课配置 | `autovisor/configs.ini` |
| 上游补丁与贡献状态 | `patches/` |

## 1. 三个程序各一行

| 程序 | 干什么 | 代码来源 / 仓库 | 本地路径 | 跑在哪台机器 | 什么时候跑 | 运行时 | 凭据从哪来 | 通知怎么发 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **微软积分** | 每天跑 Microsoft Rewards:搜索、活动、读文章,算完分推送 | 上游 `TheNetsky/Microsoft-Rewards-Script` v4.3.2(GPL-3.0)+ 本机在程序目录里的本地提交(补丁、`scripts/windows/` 运行器、`wechat-bridge/` 通知层);没有远端,`git remote` 只有 upstream | `%REWARDS_DIR%` | 本机 Windows | 登录后 3 分钟(其后 1 小时内每 10 分钟)+ 每天 08:00 起每 2 小时一次,14 小时窗口,一天最多 3 次尝试 | Node.js >= 24(实测 v24.14.0)+ Playwright 驱动浏览器 + SQLite 存登录态 | `%REWARDS_DIR%\.env`:账号邮箱与密码 | 企业微信群机器人;发送层 `wechat-bridge/`,`webhook` 在 `wechat-bridge\data\wecom-webhook.txt` |
| **微信读书签到** | 每天完成阅读挑战打卡(读满当日目标,单日上限 120 分钟),再用官方只读 API 回读校验时长真被计入 | 本仓库 `weread-signin/`(MIT;开发在本地克隆 `%WEREAD_DIR%`,无远端);底座 `funnyzak/weread-bot` 固定在 `vendor/`,commit 记在 `VENDOR_COMMIT.txt` | `%WEREAD_DIR%` | 本机 Windows | 登录后 10 分钟(1 小时内每 10 分钟重试)+ 每天 08:30 起每 60 分钟一次,14 小时窗口 | Node.js >= 20.11(实测 v24.14.0)+ Python 3(vendor 依赖 `requests` / `httpx` / `PyYAML` / `urllib3` / `croniter` / `apprise`) | `%WEREAD_DIR%\secrets\`:网页 cookie、官方只读 Key、App 渠道凭据 | 企业微信群机器人;`secrets\wecom-webhook.txt`,发送层 `src/notify.js` |
| **智慧树刷课** | Autovisor 自动播放智慧树/知到的共享课视频 | 上游 `CXRunfree/Autovisor` v3.17.3(MIT),代码未改,只改配置 | `%AUTOVISOR_DIR%\app`(原始 zip 备份在 `%AUTOVISOR_DIR%`) | **只在本机 Windows**(需要本机 Chrome 与图形会话) | **手动**跑 `Autovisor.exe`;没有计划任务 | 打包好的 exe(PyInstaller;内嵌 Python 3.10 + Playwright)+ 本机标准路径的 Chrome | 运行时手动登录一次,登录态落 `app\data\cookies.json`;`configs.ini` 的账号密码留空 | 程序自带界面与日志,不接企业微信 |

第三个任务不属于「程序」但同属这套自动化:计划任务 `AutoShutdown0200` 每天 02:00 无条件真关机
(`shutdown /s /f /t 60`,60 秒内 `shutdown /a` 可撤销),脚本
`microsoft-rewards/scripts/windows/auto-shutdown.bat`。

## 2. 仓库清单

| 仓库 | 可见性 | 作用 | 现状备注 |
| --- | --- | --- | --- |
| `Zzz210s/scripts-hub` | PUBLIC | 多个完整项目的合集,每个项目一个隔离子目录(`microsoft-rewards/`、`weread-signin/`、`wecom-notify/`、`autovisor/`),外加合集层的约定文档、补丁存档、向导与同步脚本。同时是两个没 origin 的权威工作区(`%REWARDS_DIR%`、`%WEREAD_DIR%`)的远程落点。由 `Zzz210s/home-automation-configs` 删库重建更名而来 | 同时是恢复包 |
| `Zzz210s/weread-signin` | 已删除(2026-10-04) | 曾是微信读书签到的独立仓库 | 代码已并入 `scripts-hub/weread-signin/`;本机开发克隆 `%WEREAD_DIR%` 保留 |
| `Zzz210s/automation-suite` | 已删除(2026-10-04) | 曾是自动化脚本与向导的合集仓库(私有) | 已并入 `scripts-hub/docs/`、`scripts-hub/scripts/` |
| `Zzz210s/wecom-notify` | 已删除(2026-10-04) | 曾是独立的私有企业微信通知 CLI/库 | 已并入 `scripts-hub/wecom-notify/`;此处是唯一副本 |
| `Zzz210s/weread-bot` | 已删除(2026-10-04) | 曾是 `funnyzak/weread-bot` 的 fork,只是贡献协议的上游通道 | 开放中的 PR #53 随删除被关闭;补丁存档在 `patches/weread-bot/`,镜像备份在 `%USERPROFILE%\weread-bot-backup-2026-10-04.git` |

## 3. 调度

错峰槽位、两段守卫、单实例锁、看门狗与接入清单统一写在 `docs/scheduling-convention.md`,
本机(Windows 计划任务,现状)与云主机(systemd timer,规划)两版并列。这里只留一句:
一次触发分本地段(不联网,应 < 1 秒)与联网段,本地段不满足时绝不访问网络。

## 4. 通知

企业微信群机器人,消息统一为 4 种类型(`start` / `result` / `skip` / `action`),文案有硬规则
(不用圆括号、不用 emoji、分隔符 ` · ` 等)。完整表格与模板见 `docs/notification-convention.md`。

## 5. 凭据

真实值只在各程序自己的目录里;仓库里只有模板和说明。逐个文件要填什么、去哪拿、有效期与恢复方式
见 `docs/credentials.md`。

## 6. 哪些环节必须在本机

| 必须本机 | 为什么 |
| --- | --- |
| 智慧树刷课 | Autovisor 用 Playwright 驱动**本机 Chrome** 播放视频,依赖图形会话;云主机没有可用桌面 |
| Windows 计划任务 | 现状是三个任务(`MicrosoftRewardsScript` / `WeReadSignIn` / `AutoShutdown0200`,见 `machine/scheduled-tasks.md`);搬走要换成 systemd timer |
| 看门狗、单实例锁、内存闸门 | 现在是 `.bat` / `.js`,读本机内存水位与进程表;云端要改成 `flock` + systemd 超时 |
| 02:00 无条件关机 | 本机专属任务,云端不需要 |

理论上可以搬走:**微软积分**与**微信读书签到** —— 都是纯 HTTP/脚本,不需要图形界面;瓶颈只是
缺一台 7×24 的机器,所以才有 Oracle 方案。

## 7. 未完成 / 受阻

1. **Oracle Cloud 免费 ARM 迁移:卡在注册风控,还没开通。** 详见 `docs/cloud-vm.md` 末节。
   当前所有程序仍跑在本机 Windows 计划任务上。
2. **GitHub Actions 云端方案:已评估否定。** 理由见 `docs/cloud-vm.md` 的备选方案表。
3. **智慧树不能上云**:需要图形会话与本机 Chrome,上游也不支持无头播放课件。

## 8. 上游贡献状态(`funnyzak/weread-bot`,2026-10-04 实查)

我们向该上游提过一条修复与一条 issue。**贡献用的 fork `Zzz210s/weread-bot` 已于 2026-10-04 删除**:
删除前已确认内容全部有落点(fork 的 `main` 与上游 `main` 同为 `0cc9b5c`,无自研改动;有价值的
`fix/cookie-persist-after-renewal` diff 已逐字节存进补丁),并做了镜像备份。代价是 **PR #53 因 head
分支随 fork 消失而被关闭**(`closedAt=2026-10-04T07:25:37Z`)。

| 条目 | 状态 | 详情 |
| --- | --- | --- |
| PR [#53](https://github.com/funnyzak/weread-bot/pull/53) | **已关闭(2026-10-04,因 fork 删除)** | 标题「fix: 凭据续期后把新 cookie 原子写回来源文件」;完整 diff 存于 `patches/weread-bot/pr-53-cookie-persist-after-renewal.patch`,可重新 fork 后 `git apply` 再提 |
| issue [#52](https://github.com/funnyzak/weread-bot/issues/52) | **open** | 标题「已经成功:自动领取奖励」;1 条评论(我们自己发的实测协议),维护者未回复 |

补丁、删除经过与重新提交步骤见 `patches/weread-bot/README.md`。

## 9. 维护须知

- 改「会怎么跑、什么时候跑」→ 改 `docs/scheduling-convention.md`,再改程序里的守卫。
- 改「消息长什么样」→ 改 `docs/notification-convention.md`,两边实现与测试一起改
  (文案断言已锁住「不带圆括号」与标题行形状)。
- 改微软积分的代码、运行器或通知层 → **在权威工作区 `%REWARDS_DIR%` 里改并提交**,再跑
  `scripts/sync-microsoft-rewards.sh` 发布到本仓库的 `microsoft-rewards/`(完整快照)。直接改那个
  目录必被下次同步覆盖。补丁不放项目目录,升级上游后按 `../patches/microsoft-rewards/` 的文件名顺序
  `git apply`。同步会把本机路径改成 `%REWARDS_DIR%`、按机器私有清单脱敏;缺清单脚本拒绝运行。
  完整工作模型见 `docs/workspace-model.md`。
- 改任一份企业微信发送核心 → 权威实现是 `wecom-notify/src/wecom.js` 里 `wecom-core` 标记之间的整块;
  改完把该块整段同步到 `microsoft-rewards/wechat-bridge/lib/wecom.js` 与 `weread-signin/src/notify.js`,
  再跑 `node scripts/check-wecom-drift.mjs`(不一致退出 1,`--verbose` 打印块大小)。三份只允许外壳
  (消息排版、webhook 读取、返回形状)不同,核心必须一致(按 LF 归一后逐字节)。
- 换机或全新克隆后想先确认某个项目能不能跑 → 看项目目录的 `QUICKSTART.md`(前置条件 / 三条命令 /
  凭据 / 验证 / 常见失败),或直接跑 `scripts/setup-<项目>.sh` 自检。改了自检脚本或项目步骤时,
  把 `scripts/README.md` 与对应 `QUICKSTART.md` 一起更新。
- 提交前跑 `node scripts/check-privacy.mjs`(本机路径、真实邮箱、凭据形状与机器私有标识,命中退出 1)。
- 改微信读书签到代码 → **在本机开发克隆 `%WEREAD_DIR%` 里改并提交**,再跑
  `scripts/sync-weread-signin.sh` 发布到本仓库的 `weread-signin/`。直接改那个目录必被下次同步覆盖。
- 凭据相关文件(`docs/credentials.md`、各子 README、`machine/scheduled-tasks.md`)在换机恢复时
  是唯一线索,移动路径或换文件名时一起更新。

## 10. 路径约定

文档不写死任何盘符。三个占位符指程序本体的安装目录,**按实际路径替换**:

| 占位符 | 指什么 |
| --- | --- |
| `%REWARDS_DIR%` | 微软积分的权威工作区:本机本地 git 仓库(上游 v4.3.2 + 本地改造,只有 upstream 远端);它的已跟踪文件由 `scripts/sync-microsoft-rewards.sh` 发布成 `microsoft-rewards/` |
| `%AUTOVISOR_DIR%` | Autovisor 安装目录(其下有 `app\`) |
| `%WEREAD_DIR%` | 微信读书的开发克隆 —— 一个本地 git 克隆,它的已跟踪文件由 `scripts/sync-weread-signin.sh` 发布成 `weread-signin/` |

运行器脚本都用 `%~dp0` 相对定位,整个目录可以原样挪到任何路径。必须留在本机、不入库的路径写在
私有文件 `~/.config/automation-suite/local-paths.env`(在仓库之外);那里的 `automation-suite`
是历史遗留的本机目录名,与任何 git 仓库无关。

## 11. 许可与来源

仓库整体按 **GPL-3.0** 授权(见 `LICENSE`),因为其中一部分是 GPL-3.0 上游的衍生作品:
微软积分的补丁是针对上游 TypeScript 源码的 diff,`microsoft-rewards/` 整目录是上游 v4.3.2 的同步
快照(上游 `LICENSE` 一并同步),其中 `env.example`、`config.example.json` 是上游原版文件,
`config.json` 由上游配置改写而来。

两个子目录是 **MIT**,各自保留 `LICENSE`:`weread-signin/`(继承自底座 `funnyzak/weread-bot`)
与 `wecom-notify/`(本项目自研,原独立私有仓库 `Zzz210s/wecom-notify`)。`autovisor/configs.ini`
同样来自 MIT 上游。MIT 与 GPL-3.0 单向兼容,所以它们能放进本仓库,内部文件仍按 MIT。

`patches/weread-bot/` 是上游贡献补丁的存档;那个 fork 已于 2026-10-04 删除,PR #53 随之关闭,
重新提交步骤见该目录的 README 与本文第 8 节。
