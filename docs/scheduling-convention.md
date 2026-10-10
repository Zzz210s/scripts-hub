# 调度约定:两个平台、两套模型、共同的不变量

本机所有自动化程序共用同一套**触发骨架**:**触发只负责给一次机会,程序自己判断该不该真跑**。
触发本身在两个平台上长得不一样 —— Windows 是**每个程序一个计划任务**,Linux/容器是**一个套件
timer 顺序跑完所有程序**;底下的约定(单实例锁、一天一次幂等、错峰、看门狗、通知)两边一致。

两套模型的权威实现:

| 平台 | 权威实现在哪 |
| --- | --- |
| Windows 本机 | `config/schedule.json` + `scripts/apply-schedule.mjs`(每程序一个任务);本机现状见 [local-deployment.md](local-deployment.md) |
| Linux / 云主机容器 | **`scripts/linux/`**(`systemd/automation-suite.{timer,service}` + `run-all.sh` + 各程序 `run.sh`);设计与运维见 [docker-deployment.md](docker-deployment.md) |

`apply-schedule.mjs` 的 systemd 一侧只是把 `config/schedule.json` 的 `linux` 段**渲染成同形态的 unit**,
方便干跑核对与换机重建。**Linux 侧以 `scripts/linux/` 为准**,两边不一致时改本模块去对齐它。

## 0. 时间从哪来:`config/schedule.json`

触发时刻**不写死在注册脚本里**。单一份配置是 [`../config/schedule.json`](../config/schedule.json)
(字段说明与默认值同在 `config/schedule.example.json` 的 `_readme` 里)。

Windows 侧(`programs.*`,每个程序一个计划任务):

| 字段 | 含义 | 默认值 |
| --- | --- | --- |
| `order` | 错峰顺序:谁先跑 | `microsoft-rewards` -> `weread-signin` -> `epic-free-games` -> `bilibili-tasks` |
| `stagger.baseStartTime` / `slotMinutes` | 第一个程序的每日起始时间 / 相邻程序的间隔 | `08:00` / `30` |
| `stagger.logonBaseMinutes` / `logonStepMinutes` | 登录后延迟的起点 / 步进 | `3` / `7` |
| `programs.<id>.startTime` | 每日起始时间 `HH:MM`;`auto` = 按 order+stagger 推导 | `auto` |
| `programs.<id>.intervalMinutes` | 窗口内每隔多少分钟触发一次 | 微软 `120`、微信读书 `60`、Epic `240`、B站 `120` |
| `programs.<id>.windowHours` | 每日触发窗口长度(小时) | `14` |
| `programs.<id>.maxAttemptsPerDay` | 程序内部一天最多真跑几次(不是触发次数) | `3` |
| `programs.<id>.logonDelayMinutes` | 登录后延迟几分钟触发;`auto` = 推导 | `auto`(推出 3 / 10 / 17 / 24) |
| `programs.<id>.logonRetryMinutes` / `logonRetryWindowMinutes` | 登录触发的重复间隔 / 总时长 | `10` / `60` |
| `programs.<id>.actionVbs` | 任务启动的 `run-daily.vbs`;可用 `%REWARDS_DIR%` / `%WEREAD_SIGNIN_DIR%` / `%EPIC_DIR%` / `%BILIBILI_DIR%` 占位符 | 占位符形式 |
| `programs.<id>.enabled` | `false` = 不注册它的触发 | 微软 / 微信读书 `true`;Epic 与 B站默认 `false`,各自人工登录一次后打开 |

Linux 侧(`linux`,单套件;与 `scripts/linux/systemd/` 一致):

| 字段 | 含义 | 默认值 |
| --- | --- | --- |
| `linux.unit` | 套件 unit 名(`<unit>.timer` / `<unit>.service`) | `automation-suite` |
| `linux.times` | 套件触发时刻(`HH:MM` 数组) | `08:00` 与 `12:00` |
| `linux.persistent` | `true` = 关机/重启错过的触发在开机后补跑一次 | `true` |
| `linux.suiteDir` | 套件根目录(unit 的 `WorkingDirectory` 与 `ExecStart` 前缀) | `/srv/apps/automation` |
| `linux.user` | 套件 service 的 `User` | `ubuntu` |

两份配置的消费方:

- `node scripts/apply-schedule.mjs`(默认 `--dry-run`)把它渲染成**两类**目标:Windows 任务 XML
  (每程序一个)与 Linux 单套件 systemd unit;只有 `--apply --yes` 才真注册(且只注册 Windows)。
  生成物可用 `--dest=<目录>` 落盘查看,`--emit=windows|systemd|both`、`--only=<程序id>` 收窄范围。
- `scripts/deploy-*.sh` 第 6 步拿它与**本机 Windows 任务的实际触发器**逐项比对(`start` / `delay` /
  `interval` / `duration`),不一致直接报 `[缺]` 并给出上面那条注册命令。

于是:**改时间 = 改 `config/schedule.json` -> `node scripts/apply-schedule.mjs --apply --yes`**(Windows)。
`deploy-*.sh` 只报告、不写任务。配置缺失时回退 `config/schedule.example.json` 的默认值并警告。

`maxAttemptsPerDay` 是**程序内部**的守卫阈值:微信读书读 `.env` 的 `MAX_ATTEMPTS_PER_DAY`,
微软积分写在 `run-daily.bat` 里(改它要改工作区,见 [workspace-model.md](workspace-model.md))。
配置里改这个字段只改「登记值」与触发机会数校验,不改程序行为。

## 1. 两个平台,两套模型

| 项 | Windows 本机 | Linux / 云主机容器 |
| --- | --- | --- |
| 触发粒度 | **每个程序一个计划任务**(`MicrosoftRewardsScript` / `WeReadSignIn` / `EpicFreeGames`) | **单套件** `automation-suite.timer` -> `automation-suite.service` |
| 触发时刻 | 登录后延迟(3 / 10 / 17 分钟)+ 08:00 / 08:30 / 09:00 起,窗口内周期重复 | 每天 **08:00 与 12:00** 各一次 |
| 补跑 | **不补跑**:关机/忙碌错过的那次直接丢,靠窗口内下一次补 | `Persistent=true`:关机/重启错过的触发**开机后补跑一次** |
| 顺序 | **靠错峰时刻 + 同伴互查**去赌不重叠 | **`run-all.sh` 严格串行**(先微软积分,返回后才启动微信读书) |
| 单实例锁 | 程序目录 `logs\run.lock`(JSON)+ 进程实况判残锁 | 宿主 `state/suite.flock`(编排级)+ 各程序自己的 `flock`/锁文件 |
| 幂等 | 一天一次(逻辑日 04:00 为界)+ 程序内守卫 | 同一套:程序自己看状态文件,已完成就退出(退出码 0) |
| 权威实现 | `config/schedule.json` + `apply-schedule.mjs` | `scripts/linux/`(timer/service + `run-all.sh` + 各 `run.sh`) |

**为什么可以不同**:

- Windows 的计划任务有丰富的触发器(登录触发 + 每日起点 + 周期重复 + 窗口),用**错峰时刻**把
  三个程序摊开最省事;代价是机器不一定在线,错过不补,只能靠窗口内多次机会兜。
- Linux 的 systemd timer 只有 `OnCalendar`(定时)与 `Persistent`(补跑)。与其写三个错峰 timer
  去赌「微软积分那次 40 分钟能按时结束」,不如**一个 timer + 一个 oneshot 编排脚本**:顺序由脚本
  保证,一项结束才启动下一项,永远不重叠。08:00 主力、12:00 兜底,两次触发也不怕 —— 幂等守卫让
  已完成的那天一秒跳过。这与 Windows 的「多次机会」思路一致,只是把「机会」从 7 次压缩到 2 次,
  由 `Persistent` 补上错过的。

## 2. 错峰槽位(Windows)与顺序(Linux)

Windows 侧,下表是 `config/schedule.json` 的默认值;真实时刻以配置为准(第 0 节)。

| 程序 | 本机触发 | Windows 幂等依据 |
| --- | --- | --- |
| 微软积分 | 登录后 3 分钟(其后 1 小时内每 10 分钟重试)+ 08:00 起每 120 分钟一次 | `logs\last-run.state` 记 `日期 9` = 当天已完成 |
| 微信读书签到 | 登录后 10 分钟(1 小时内每 10 分钟重试)+ 08:30 起每 60 分钟一次 | `data\state.json` 的 `done` 与尝试次数 |
| Epic 限免领取 | 登录后 17 分钟(1 小时内每 10 分钟重试)+ 09:00 起每 240 分钟一次,窗口 14 小时,一天最多真跑 2 次;**默认 `enabled: false`,人工登录一次后在配置里打开** | `data\state.json` 的已领记录与当日尝试次数 |

- 每个程序占一个 **30 分钟槽位**,新程序顺延(08:00 微软 -> 08:30 微信读书 -> 09:00 Epic)。
- 登录延迟按 **7 分钟步进**错开(3 -> 10 -> 17),因为开机瞬间网络与系统未必就绪。
- 白天用「14 小时时间窗 + 周期重复」给多次机会;错过的靠窗口内下一次补。

Linux 侧**不需要错峰时刻**:套件按 `run-all.sh` 里的固定顺序串行执行,顺序与 `config/schedule.json`
的 `order` 一致(`microsoft-rewards` -> `weread-signin` -> ...)。要加程序就改 `order` 与 `run-all.sh`。
`apply-schedule.mjs --emit=systemd` 生成的 `systemd/order.txt` 就是给人核对这条顺序用的。

Linux 云主机 7×24 在线,触发一定到,所以重点是**幂等**而不是抢时间窗:程序自己看状态文件,今天已完成
就退出(退出码 0),触发两次是安全的。时刻用主机本地时区(建议 `Asia/Shanghai`)。

## 3. 共同的不变量(两边都必须满足)

无论外壳是计划任务还是 systemd timer,一次触发都必须同时满足这五条:

1. **单实例锁**:同一程序同时只跑一次;编排级还有一把套件锁。锁必须能自动回收(进程死即失灵,
   或用进程实况判残锁)。
2. **一天一次幂等**:程序内部按逻辑日判「今天是否已完成 / 尝试次数是否用尽」;触发多了无害。
3. **错峰 / 同伴互查**:同机多个程序别同时抢内存、网络与出口 IP;任一在跑就跳过本次。
4. **看门狗**:单次运行超过上限就强杀整棵进程树并记为失败,当天剩余触发可重试。
5. **通知**:按 [notification-convention.md](notification-convention.md) 发,不重不漏。

## 4. 两段守卫

一次触发分两段,本地段不满足时**绝不访问网络**。

**本地段(不联网,应 < 1 秒)**:已暂停 / 当天已达标 / 尝试次数用尽 / 同伴在跑 / 安静时段
(默认 20:00-23:00)/ 距 02:00 关机不足 30 分钟 / 可用内存不足。

内存闸门:微软积分运行前按可用内存自适应写回 `clusters`(≥2500MB → 2 并行,1200-2499MB → 1,
<1200MB 直接跳过本次);微信读书低于 600MB 跳过。云主机上这两个阈值可调(见 `scripts/linux/suite.env`:
`REWARDS_MIN_FREE_MB`、`REWARDS_FREE_MB_FOR_PARALLEL`)。

**联网段**:凭据体检与滚动续期 → 读官方数据 → 真跑。

微软积分的逻辑日以 **04:00** 为界(凌晨那次算前一天),保证开机后那次一定是新一天的第一跑。

云主机上去掉的守卫只有「关机避让」(没有 02:00 关机)与微软积分的「安静时段」(没人在这台机器上阅读);
微信读书在云端保留安静时段。见 [docker-deployment.md](docker-deployment.md) 第 3 节。

## 5. 同伴互查与单实例锁

运行前先看同伴有没有在跑,任一在跑就跳过本次(小规格机器别同时抢内存与出口 IP)。

| 环境 | 锁 | 说明 |
| --- | --- | --- |
| Windows 本机 | 单实例锁 `logs\run.lock`,内容 JSON 含 `pid` 与 `startedAt` | 判定以进程实况为权威(是否有 node 在跑 `dist\index.js`),残留锁立即回收,所以崩溃留下的锁挡不住重试;同伴是否在跑以对方自己的 `lock-status` 为准,只在查不通时才按锁年龄兜底 |
| Linux / 容器 | `flock` 排他锁:编排 `state/suite.flock`,各程序自己的锁 | 进程一死锁自动释放,不存在残锁问题;另写一份 JSON `run.lock` 给同伴的错峰判定用 |

`.env` 里用 `BUSY_PEERS=` 列出同伴的锁文件路径(逗号分隔,正斜杠);云主机上微信读书的
`BUSY_PEERS=/peers/rewards/run.lock`。

## 6. 看门狗与超时

| 程序 | 超时 | 行为 |
| --- | --- | --- |
| 微软积分 | `run-watchdog.bat` 默认 150 分钟(云主机 `REWARDS_RUN_TIMEOUT_MIN`) | 超时强杀整棵进程树(容器则 `docker rm -f`),发通知说明;当天剩余触发重试未完成的账号 |
| 微信读书签到 | `RUN_TIMEOUT_MINUTES=100`(云主机 `WEREAD_RUN_TIMEOUT_MIN`) | 同理,单次运行上限 100 分钟 |
| Epic 限免领取 | 引擎 30 分钟(`EPIC_ENGINE_TIMEOUT_MINUTES`) | 超时就强杀引擎进程树并推失败通知;探测那一步是 20 秒超时 |

配套余量:微软积分最近一次实测 44.3 分钟(5 个账号),150 分钟的超时线留得很足。云主机上套件
service 的 `TimeoutStartSec=infinity`(不掐断编排),超时交给各自的看门狗。

## 7. 通知

消息类型、频率限制与文案规则见 [notification-convention.md](notification-convention.md)。
一句话版:一次运行最多两条(开始 + 结束);跳过类同一天同一种原因最多一条,其中不需要人做任何事的
那些只写日志不推送;需要人工处理的(凭据失效、读不到数据)不受限制。

## 8. 新程序接入清单

**本机 Windows**:

1. 用同一套运行器:`scripts\windows\` 下的 `run-daily.bat` + `run-daily.vbs`(隐藏窗口)+
   `run-state.js`(锁/配额/内存/强杀)+ 看门狗 + XML 注册脚本。
2. 单实例锁写 `logs\run.lock`,内容 `{"pid":<pid>,"startedAt":"<ISO>"}`。
3. 在 `.env` 里用 `BUSY_PEERS=` 列出同伴的锁文件路径。
4. 在 `config/schedule.json` 里加一项程序(槽位与登录延迟写 `auto` 就按 `order` 与 `stagger` 顺延),
   跑 `node scripts/apply-schedule.mjs --dry-run` 核对生成的触发器,再 `--apply --yes` 注册。
5. 本地段守卫至少包含:同伴在跑 / 当天已完成 / 安静时段 / 关机避让 / 内存不足。

**Linux / 容器**:权威实现在 `scripts/linux/`,接入步骤以其 `README.md` 与
[docker-deployment.md](docker-deployment.md) 为准,要点:

1. 写程序自己的 `run.sh`(宿主侧守卫 + 看门狗 + 通知),在 `run-all.sh` 里按 `order` 排队。
2. 触发不用新写 timer:套件 `automation-suite.timer` 一天两次,新程序跟着套件一起跑;要改时刻只改
   `config/schedule.json` 的 `linux.times` 或直接改 `scripts/linux/systemd/automation-suite.timer`。
3. 单实例锁用 `flock`(进程死锁自动释放);跨容器读取时补 JSON 锁文件给同伴判定。
4. 接入后手动 `sudo systemctl start automation-suite.service` 验证守卫能正确跳过或执行,
   `systemctl list-timers automation-suite.timer` 核对触发时刻。
