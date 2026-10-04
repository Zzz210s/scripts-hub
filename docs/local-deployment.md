# 本机部署现状(2026-10-05 盘点)

这台机器上的自动化**实际是怎么装起来的**:权威工作区在哪、计划任务怎么注册、入口脚本怎么串起来、
哪些是本机私有文件。换机恢复、排查「为什么没跑」、改动运行器前先读这一篇。

- 调度规则本身(错峰槽位、两段守卫、单实例锁、看门狗):[`scheduling-convention.md`](scheduling-convention.md)
- 程序是什么、代码在哪、跑在哪台机器、凭据放哪:`automation-overview.md`、`credentials.md`
- 改代码进仓库:`workspace-model.md`
- 本文只讲「这台机器上怎么落地」。

本文件由原来的 `machine/scheduled-tasks.md` 与 `machine/weread-deployment.md` 合并而成(2026-10-05),
不再有第二份。

## 1. 部署的组成部分

| 组成 | 是什么 | 在哪 |
| --- | --- | --- |
| 权威工作区 | 可运行的程序目录(改代码也在这些目录里) | `%REWARDS_DIR%`、`%WEREAD_DIR%`;路径写在机器私有文件里 |
| Windows 计划任务 | 三个任务,负责在正确时刻给一次「机会」 | 任务库;清单见第 3 节 |
| 入口脚本 | `.vbs`(隐藏窗口)→ `.bat`(守卫 + 启动) | 各工作区 `scripts\windows\` |
| 程序内运行器 | 单实例锁、看门狗、内存闸门、错峰、状态文件 | 同上;说明见第 4 节 |
| 本机私有配置 | 路径映射与个人标识清单,永不入库 | `~/.config/automation-suite/local-paths.env`、`sensitive-patterns.txt` |
| 凭据 | 账号、cookie、webhook、API Key | 各工作区;逐个文件见 [`credentials.md`](credentials.md) |
| 运行时 | Node.js(两个程序)、Python 3(微信读书底座)、Playwright/Chromium(微软积分) | 系统级安装 + 浏览器缓存 |
| 合集仓库 | 快照、约定文档、同步与部署脚本 | 本仓库;`scripts/sync-*.sh` 发布,`scripts/deploy-*.sh` 落地 |

一句话:**计划任务只负责触发,程序自己判断该不该真跑**;仓库里的快照是权威工作区的发布副本,
部署脚本负责把快照刷回工作区并体检。

## 2. 权威工作区与从仓库恢复

| 项目 | 工作区 | 仓库落点 | 落地方式 |
| --- | --- | --- | --- |
| 微软积分 | `%REWARDS_DIR%`(默认盘符路径见机器私有文件) | `proj-microsoft-rewards/`(完整快照) | `bash scripts/deploy-microsoft-rewards.sh --apply` |
| 微信读书签到 | `%WEREAD_DIR%` | `proj-weread-signin/`(完整快照) | `bash scripts/deploy-weread-signin.sh --apply` |
| 智慧树刷课 | `%AUTOVISOR_DIR%\app` | `proj-autovisor/`(只有配置) | 手动:复制 `configs.ini` 到 `app\` |
| Epic 限免领取 | 就是 `%EPIC_DIR%`(默认等于仓库里的 `proj-epic-free-games/`,无需另建工作区) | `proj-epic-free-games/`(代码本体) | 不需要部署:直接在项目目录里跑;真跑前 `npm install` + `npx patchright install chromium` + `node src/cli.js login` |

换机恢复的顺序:克隆本仓库 → 建机器私有文件(第 5 节) → 从上游装程序本体 → 跑对应 `deploy-*.sh --apply`
把仓库里的配置与运行器刷进工作区 → 按 `credentials.md` 填凭据 → 注册计划任务 → 跑 `setup-*.sh` 自检。

`deploy-*.sh` 默认 `--dry-run`(只报告),`--apply` 才写文件;**不碰计划任务**,只检查并告诉你缺什么。
用途是**换机恢复**:从上游装好程序本体后,把仓库里的运行器、通知层与配置刷进工作区。

**不会覆盖权威工作区**:快照是脱敏后的对外发布件(本机绝对路径 → `%REWARDS_DIR%` / `%WEREAD_DIR%`,
个人标识 → `sample`),把它写回本机权威工作区会把占位符带回去。所以工作区 git HEAD 与快照
`SNAPSHOT.txt` 的源提交**一致**时,脚本判定“同源”,跳过文件刷新;`--apply` 会直接报错退出。
日常“刷新”要走反方向:`sync-*.sh`(工作区 → 仓库),不要 `deploy`。

### 2.1 什么情况下才用 `--allow-authoritative`

`deploy-*.sh` 只在换机恢复时写文件;默认拒绝覆盖与快照同源的工作区。确实需要拿快照
**反向覆盖**一份同源工作区时(例如权威工作区被改坏、要从已发布快照重建),显式加
`--allow-authoritative`。它不会静默放行,四道闸门按顺序走:

1. **先预览**:逐文件打印 `新增 / 覆盖 / 跳过 / 保留` 与汇总,不看清单不会往下走;
2. **再警告**:明确提示快照是脱敏发布件,覆盖会把真实账号名/邮箱替换成 `sample`、把本机
   绝对路径替换成 `%REWARDS_DIR%` / `%WEREAD_DIR%` 占位符 —— 这是**有损**操作;
3. **二次确认**:交互式要手输 `yes`;非交互环境(CI、管道、无终端)必须再给 `--yes`,
   否则直接中止、不写任何文件;
4. **自动备份**:执行前把将被覆盖的文件复制到
   `~/.config/automation-suite/backups/<快照名>-<时间戳>/`,结束时打印该路径与恢复命令
   (`cp -r "<备份目录>/." "<工作区>/"`);`DEPLOY_BACKUP_DIR` 可改备份根。

`--force` 是 `--allow-authoritative` 的旧名,现在完全等同(也会预览、确认、备份),不再有静默跳过。
**什么时候不该用**:日常代码改动进仓库,永远走 `sync-*.sh`;只有“工作区坏了、要从仓库重建”
才反向覆盖,而且覆盖后要按 `sync-*.sh` 重新把工作区当权威源刷新一遍仓库,避免占位符长期留在工作区。

## 3. 计划任务清单

这台机器上装着的、与自动化程序相关的 Windows 计划任务。三者都是「仅当前用户、交互式/有限权限」,
不存密码,重启后仍在任务库里。

| 任务名 | 触发器 | 作用 | 日志/状态落点 |
| --- | --- | --- | --- |
| `MicrosoftRewardsScript` | 登录后 3 分钟(其后 1 小时内每 10 分钟重复)+ 每天 08:00 起每 2 小时一次,14 小时窗口 | 跑微软积分,一天最多 3 次尝试,成功即锁 | `%REWARDS_DIR%\logs\last-run.state`(`日期 9` = 当天已完成) |
| `WeReadSignIn` | 登录后 10 分钟(1 小时内每 10 分钟重复)+ 每天 08:30 起每 60 分钟一次,14 小时窗口 | 跑阅读会话并用官方只读 API 校验时长 | `%WEREAD_DIR%\data\state.json` 的 `done` |
| `AutoShutdown0200` | 每天 02:00(`WakeToRun=True`) | 无条件真关机 `shutdown /s /f /t 60`(60 秒内 `shutdown /a` 可撤销) | 无 |

表中前两行的时刻**不写死在脚本里**,来自仓库 [`../config/schedule.json`](../config/schedule.json)
(字段与默认值见 [`scheduling-convention.md`](scheduling-convention.md) 第 0 节);上面列的是默认值。

- 登录触发按 7 分钟步进错开:微软 3 分钟、微信读书 10 分钟。
- **Epic 限免领取(`EpicFreeGames`)尚未注册**:`config/schedule.json` 里它的条目写着 `enabled: false`,
  因为领取要先人工登录一次浏览器(`node src/cli.js login`)。登录后把 `enabled` 改成 `true`,
  再跑 `node scripts/apply-schedule.mjs --apply --yes`,它会是登录后 17 分钟 + 09:00 起每 240 分钟一次。
- 白天的周期重复只为「给多次机会」:开机晚、机器忙、关机,错过的那次直接丢失(计划任务不补跑),
  靠窗口内的下一次补上;程序自己的幂等守卫保证重复触发无害。
- 智慧树刷课**没有**计划任务,手动运行。
- 本机计划任务是**每个程序一个任务**(登录触发 + 每日窗口);云主机/容器是**单套件**
  `automation-suite.timer`(08:00 与 12:00、`Persistent=true`、`run-all.sh` 顺序跑完所有程序)。
  两套外壳不同,运维同一套约定(单实例锁、一天一次幂等、看门狗、通知)—— 见
  [`scheduling-convention.md`](scheduling-convention.md) 第 1 节与 [`docker-deployment.md`](docker-deployment.md)。

查看与操作:

```powershell
# 看状态与上次/下次运行
Get-ScheduledTask -TaskName MicrosoftRewardsScript | Get-ScheduledTaskInfo
Get-ScheduledTask -TaskName WeReadSignIn | Get-ScheduledTaskInfo
# 立刻手动触发一次
Start-ScheduledTask -TaskName MicrosoftRewardsScript
# 停用 / 删除
Disable-ScheduledTask -TaskName WeReadSignIn
Unregister-ScheduledTask -TaskName WeReadSignIn
```

注册方式(重新注册也用它,可重复跑)。前两个任务用**统一入口**,触发器由 `config/schedule.json` 生成:

```bash
node scripts/apply-schedule.mjs --dry-run      # 只打印会生成的 XML/unit,不动本机任务
node scripts/apply-schedule.mjs --apply --yes  # 真注册(覆盖同名任务)
```

| 项目 | 注册命令 | 任务名与触发器写在哪 |
| --- | --- | --- |
| 微软积分 + 微信读书签到 | `node scripts/apply-schedule.mjs --apply --yes` | 仓库 `config/schedule.json`;生成物是任务 XML 与 systemd timer |
| 微软积分(工作区自带脚本,备用) | 工作区 `scripts\windows\install-autostart.bat` | 时刻是写死的历史值(08:00 / 2h / 14h),改时间请改配置 |
| 微信读书签到(工作区自带脚本,备用) | `powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1` | 时刻是写死的历史值(08:30 / 60m / 14h);登录延迟必须是 `PT10M` 形式 |
| 关机 `AutoShutdown0200` | 见 `proj-microsoft-rewards/scripts/windows/` 同目录文档 | 固定 02:00,不在调度配置里 |

工作区自带的两个 `install-autostart*` 仍在、与配置默认值一致,
但**它们不知道配置** —— 改时间只改 `config/schedule.json` 并跑上面的统一入口。

微信读书必须用 XML 注册:登录触发器的 `Delay` 只能写成 `PT10M`,PowerShell 的 `.Delay = TimeSpan`
会序列化成 `00:10:00`,任务计划程序判定 XML 非法(`0x80041318`)。

## 4. 入口脚本与运行器守卫

两个程序的入口链一致:`wscript.exe run-daily.vbs`(无窗口)→ `run-daily.bat`(守卫 + 启动)→ 程序。

微软积分 `scripts\windows\run-daily.bat` 的守卫,按顺序:

1. 单实例锁 `logs\run.lock`;判定以**进程实况**为权威(是否有 node 在跑 `dist\index.js`),残留锁立即回收。
2. 一天一次:`logs\last-run.state` 记 `逻辑日 9`(成功)或尝试次数;逻辑日以**本地 04:00** 为界,
   凌晨那次算前一天(否则凌晨补跑会把新一天标成已完成,2026-09-24 的事故)。
3. 凭据守卫:`.env` 还是示例账号就不跑,推一条「需要你处理」。
4. 内存闸门 `run-config.js decide`:可用内存 < 1200MB 直接跳过(不消耗当天尝试次数);1200-2499MB 降到
   单集群;≥2500MB 开两个集群。
5. 看门狗 `run-watchdog.bat`(默认 150 分钟):卡死的整棵进程树被强杀并写 marker,当天剩余触发重试。
6. 结束后按日志分类成功/失败,推结果通知(`notify-run.js`)。

微信读书 `scripts\windows\run-daily.bat` 的守卫:单实例锁 → 配额 `quota`(MET|PENDING)→ 内存闸门
(<600MB 跳过并推 `low-memory`)→ 看门狗(`RUN_TIMEOUT_MINUTES=100`)。程序内再跑两段守卫(本地段不
联网,联网段做凭据体检与官方统计),详见 `proj-weread-signin/README.md` 与 `scheduling-convention.md`。

临时暂停某程序不用动任务:在程序目录放标记(微软用 `logs\last-run.state` 之外的守卫,微信读书用
`data/paused`;`node src/index.js pause` / `resume`)。

## 5. 本机私有文件(永不入库)

`~/.config/automation-suite/` 下两个文件,仓库脚本运行时读它们:

| 文件 | 内容 | 谁用 |
| --- | --- | --- |
| `local-paths.env` | `WEREAD_SIGNIN_DIR`、`REWARDS_DIR`、`HOME_AUTOMATION_CONFIGS_DIR`、备份镜像 glob | `scripts/sync-*.sh`、`scripts/deploy-*.sh` |
| `sensitive-patterns.txt` | 一行一个个人标识(真名、邮箱、用户名);同步时替换为 `sample` | `scripts/sync-microsoft-rewards.sh`、`scripts/check-privacy.mjs` |

- 文件名与目录名 `automation-suite` 是历史遗留值,**改了本机脚本就失效**,保持不动。
- `sensitive-patterns.txt` 缺失时 `sync-microsoft-rewards.sh` **拒绝同步**(它是一道防误发的安全属性,
  不允许降级为「悄悄跳过脱敏」)。模板见 `scripts/sensitive-patterns.txt.example`。
- 这两个文件是**路径与标识配置**,不是凭据;凭据清单见 [`credentials.md`](credentials.md)。

## 6. 微软积分:本机部署

- 工作区 `%REWARDS_DIR%`(本地 git 仓库,只有 `upstream` 远端,没有 origin)。仓库快照 `proj-microsoft-rewards/`
  由 `scripts/sync-microsoft-rewards.sh` 发布,由 `scripts/deploy-microsoft-rewards.sh` 刷回工作区。
- 目录分层:运行器 `scripts\windows\`、通知层 `wechat-bridge\`、源码 `src\`。
- 运行时:Node.js >= 24;`npm ci` 装依赖;`npx patchright install chromium` 装浏览器;
  `npm run build` 生成 `dist\`(程序入口是 `dist\index.js`)。
- 凭据:`.env`(账号邮箱与密码)、`wechat-bridge\data\wecom-webhook.txt`(可选)。
- 日志与状态:见第 3、4 节的落点;运行日志 `logs\last-run.log`(上一次在 `previous-run.log`)。

## 7. 微信读书签到:本机部署

程序做什么、命令有哪些、配置项含义:见 `../proj-weread-signin/README.md`。这里只记本机。

- 工作区 `%WEREAD_DIR%`(本地克隆,无远端)。程序本体在仓库 `proj-weread-signin/`,由
  `scripts/sync-weread-signin.sh` 发布、`scripts/deploy-weread-signin.sh` 刷回。
- 底座 `funnyzak/weread-bot`(MIT)固定在 `vendor/` 下,commit 记在 `proj-weread-signin/VENDOR_COMMIT.txt`。
- 本程序自己补的三块:读回校验、按剩余进度算每日目标、Windows 无人值守调度。
- 每次触发分两段过守卫。**本地段**(不联网,约 0.7 秒):已达标 / 尝试次数 / 同伴在跑 / 安静时段
  (20:00-23:00)/ 距关机不足 30 分钟 / 内存不足 600MB;**联网段**:凭据体检(失效自动续期)与官方统计读取。
  本地段不满足时不访问网络。
- 通知走企业微信:真跑一次发「开始 + 结束」两条;跳过类同一天同一种原因最多一条;凭据失效每次提醒。
  文案规则见 [`notification-convention.md`](notification-convention.md)。
- 登录会过期,程序自己续:`wr_skey` 约 1.5 小时,`wr_rt` / `wr_vid` / `wr_pf` 360 天,都是滚动刷新。
  只有长期不开机(超过 360 天)或别处主动退出登录后,才需手动重抓 `read` 请求的 cURL 覆盖
  `secrets\read-request.curl`(提取命令见 `proj-weread-signin/README.md`)。

日志与状态(都在 `%WEREAD_DIR%` 下):

| 路径 | 内容 |
| --- | --- |
| `logs\last-run.log` | 最近一次运行输出(上一次在 `previous-run.log`) |
| `logs\weread.log` | 底座日志(请求进度、成功/失败) |
| `data\state.json` | 当日状态(今日分钟、目标、尝试次数、是否达标) |
| `data\history.json` | 最近 200 次运行记录 |
| `data\paused` | 存在即暂停 |

## 8. 换机恢复检查表

1. Node.js(两个程序都跑 v24)、Python 3(底座)、`git`、`gh`。
2. 克隆本仓库;建 `~/.config/automation-suite/local-paths.env` 与 `sensitive-patterns.txt`。
3. 从上游装程序本体到两个工作区,跑 `deploy-*.sh --apply` 刷入仓库配置与运行器。
4. 按 `credentials.md` 补齐 `.env`、`secrets\*`、`wechat-bridge\data\wecom-webhook.txt`。
5. `npm ci` + `npx patchright install chromium` + `npm run build`(微软);`--vendor` 克隆底座(微信读书)。
6. 注册计划任务:`node scripts/apply-schedule.mjs --dry-run` 核对后 `--apply --yes`(时刻来自 `config/schedule.json`);关机任务另按工作区文档。
7. 跑 `bash scripts/setup-<项目>.sh` 与对应 `deploy-*.sh --dry-run` 逐项核对。
