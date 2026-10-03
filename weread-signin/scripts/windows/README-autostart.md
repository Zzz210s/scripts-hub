# 无人值守说明(计划任务与守卫)

## 计划任务

任务名 `WeReadSignIn`,由当前用户运行、交互式、有限权限,不保存密码。

| 触发 | 说明 |
| --- | --- |
| 登录后 10 分钟 | 并在其后 1 小时内每 10 分钟重复一次(机器在那几分钟里再睡也能补上) |
| 每天 08:30 起每 60 分钟一次,持续 14 小时 | 白天的多次机会;机器关机时该次触发直接丢失,不会补跑 |

- 不唤醒机器(`WakeToRun=false`),错过后尽快启动(`StartWhenAvailable=true`),多实例策略 `IgnoreNew`。
- 注册:`powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1`
- 卸载:`Unregister-ScheduledTask -TaskName WeReadSignIn`
- 查看:`Get-ScheduledTask -TaskName WeReadSignIn | Get-ScheduledTaskInfo`

注册脚本用 XML 而不是 `New-ScheduledTaskTrigger`:登录触发器的 `Delay` 只能写成 `PT3M`,用 PowerShell 的 `.Delay = TimeSpan` 会序列化成 `00:03:00`,任务计划程序判定 XML 非法(错误 `0x80041318`)。

## 每次触发要过的守卫

**第一段(本地,不联网,约 0.7 秒)** —— 不满足就直接退出,不去碰接口:

| 顺序 | 条件 | 结果 |
| --- | --- | --- |
| 0 | 已有同一次运行在跑(`logs/run.lock`,在 .bat 里判) | 退出;残留锁(崩溃/断电)立即回收 |
| 1 | 今天已达标(`data/state.json` 的 `done`) | 退出 |
| 2 | 今天已尝试 3 次 | 退出 |
| 3 | 同伴程序(微软积分)正在运行 | 退出,错峰 |
| 4 | 处于安静时段(默认 20:00-23:00) | 退出,避免影响真实阅读 |
| 5 | 距关机不足 30 分钟(关机时刻默认 02:00) | 退出,避免跑一半被关机掐断 |
| 6 | 可用内存低于 600MB(.bat 里判) | 退出,等下一次触发 |

**第二段(联网)**:凭据体检(失效则自动续期)→ 读官方统计 → 算「今天还能读多少」(见下节);凭据或统计有问题才退出。

同伴是否在跑以**对方自己的 `lock-status`** 为准(它知道残锁与进程实况);只有查不通时才按锁的年龄兜底,且只对 10 分钟内的新锁保守让路。

## 通知怎么发

- 真跑一次:**开始一条 + 结束一条**(共 2 条)
- 跳过:**同一天同一种原因最多一条**,文案说明发生了什么/为什么/接下来会怎样
- 凭据失效、统计读不到:**每次都提醒**(需要人工处理)
- 提醒额度记在 `data/notify-state.json`;`--dry` 不消耗额度

手动运行不受安静时段限制:`node src/index.js run --force`。

凭据由运行前的体检自动续期;想手动推一次有效期窗口用 `node src/index.js auth --force`,只看状态用 `node src/index.js auth`。

## 看门狗

`run-daily.bat` 启动真实运行前,会后台拉起 `run-watchdog.bat`:

- 默认等待 100 分钟(`WEREAD_RUN_TIMEOUT_MIN` 可覆盖);
- 到点后比对锁文件的时间戳 —— 若还是同一次运行(没换过锁),杀掉整棵进程树并写 `logs\runner.log`;
- 锁已更换说明是后来的一次运行,看门狗直接退出,不会误杀。

## 日志与状态

| 路径 | 内容 |
| --- | --- |
| `logs\last-run.log` | 最近一次运行的输出(每次运行前把旧的挪到 `previous-run.log`) |
| `logs\weread.log` | 底座自己的日志(请求进度、成功/失败) |
| `logs\run.lock` | 单实例锁(JSON,含 pid 与开始时间) |
| `data\state.json` | 当日状态:今日分钟、目标、尝试次数、是否达标(跨天自动重置) |
| `data\history.json` | 最近 200 次运行记录(目标区间、读回前后分钟、请求数、结果) |
| `data\paused` | 存在即暂停所有自动运行(`node src/index.js pause` / `resume`) |

## 常用命令

```powershell
# 今天该读多久(只算不跑)
node src/index.js plan
# 立刻跑一次(手动,不受安静时段限制)
node src/index.js run --force
# 状态与最近记录 + 官方统计
node src/index.js status
# 只看官方读回
node src/index.js verify
# 暂停 / 恢复
node src/index.js pause
node src/index.js resume
# 只预览不发送通知
node src/index.js run --dry
```

## 账号名

日报与底座日志里的用户名取自**官方接口返回的昵称**(运行前体检时顺带取回),并自动写进 `config.yaml`
的多用户段。底座的单用户模式固定显示 `default`,所以配置用多用户模式承载单个用户。

## 错峰

与微软积分对齐但错开:它 08:00 起、登录后 3 分钟;本程序 08:30 起、登录后 10 分钟。
另外运行前会读同伴的锁文件(`BUSY_PEERS` 配置),任一在跑就跳过本次。约定见配置方案仓库的
`tasks/scheduling-convention.md`。

## 与关机任务的关系

本机 `AutoShutdown0200` 每天 02:00 无条件真关机。守卫第 5 条保证不会在关机前启动跑不完的会话;若关机时刻变了,改 `.env` 的 `SHUTDOWN_TIME` 即可。

## 挑战起止日期

`.env` 里的 `CHALLENGE_START` / `CHALLENGE_ENDS_ON` 决定"每天该读多久"。没配时按"今天起 30 天"兜底,并在企业微信日报里提醒核对。

## 每日目标怎么算

目标不是"今天应该读多少",而是"今天还读得到多少" —— 算完还要过一遍当天真实可跑的窗口:

1. **理想目标** = `ceil(剩余分钟 / 剩余天数) + SLACK_MINUTES`,夹在 `MIN_VALID_MINUTES` 与 `DAILY_CAP_MINUTES` 之间;挑战总量已达标时取最小有效时长。
2. **今日窗口** = 三者取最小:剩余可跑次数 × `RUN_TIMEOUT_MINUTES`(默认 100)、到安静时段开始的分钟数、到 `SHUTDOWN_TIME` 关机再减 `SHUTDOWN_GUARD_MINUTES`。正处安静时段为 0。
3. **今日目标** = `max(MIN_VALID_MINUTES, min(理想目标, 今日已读 + 今日窗口))` —— 已读的算进可达值,窗口不够就把目标压下来,缺口由后面的日子按 `剩余/剩余天数` 自然分摊。**有效日下限(默认 5 分钟)不会被压破**,任何一次运行都保证今天能算有效日。
4. **本次会话** = `min(今日目标 - 今日已读, RUN_TIMEOUT_MINUTES)`。写进底座 `config.yaml` 的 `target_duration` 就是这个值,不是整天的目标 —— 已完成的部分不重复跑,超出的部分留给下一次触发。
5. 今天已读已到目标(含你自己在手机上读的)时不再启动会话;扣掉今天能补的量后,后面每天要扛超过 90 分钟就进紧急模式并提示。

`node src/index.js plan` 会打印日期、剩余量、今日目标、今日窗口、本次会话与段落计划,只看不跑。

## 开始提醒格式

运行前发一条,并在运行前预览一次挑战、余额与体验卡(拿不到就不显示对应行):

```
微信读书签到 · <账号名> · <日期> · 开始自动阅读

今天:目标 60 分钟 · 已完成 X 分钟
计划:分 2 段 · 共 30 分钟 · 结束后推送本次结果与官方读回数字
窗口:今天还能跑 30 分钟 · 目标按窗口下调 · 缺口留给后面几天
后续:本次会话 100 分钟 · 还差 20 分钟由下一次触发补
挑战:付费 30 天 · X / 30.0 小时 · 已读 X/29 天 · 剩 N 天 · 还可漏 N 天
免费 21 天 · X / 10.0 小时 · 已读 X/21 天 · 剩 N 天 · 不能再漏天数
福利:书币余额 X.XX · 体验卡 N 天 · 即将过期 X.XX
```

`窗口` 行只在目标被当天窗口下调时出现,`后续` 行只在一次会话写不下当天缺口时出现。

## 日报格式

```
微信读书签到 · <账号名> · <日期> · 运行成功

阅读:今日 X 分钟 · 目标 Y 分钟 · 已达标 / 还差 Z 分钟
本次:上报 X 分钟 · N 次请求 · 成功 · 官方计入约 X 分钟
挑战:付费 30 天 · X / 30.0 小时 · 已读 X/29 天 · 剩 N 天 · 还可漏 N 天
免费 21 天 · X / 10.0 小时 · 已读 X/21 天 · 剩 N 天 · 不能再漏天数
福利:书币余额 X.XX · 体验卡 N 天 · 即将过期 X.XX · 本周 8 档 · 已领 5 · 未达成 3
```

- 文案里不用圆括号,所有补充说明一律用 ` · ` 分隔(开始提醒、日报、跳过提醒都适用)
- 挑战行来自官方接口,一条挑战一行,两条都**顶格**(第一条 `挑战:` 开头);接口读不到时回落到 `挑战:累计 X / Y 小时 · 剩 N 天 · 有效 X/29 · 还可漏 N 天`
- `canMiss` 为 0 时写 `不能再漏天数`
- 挑战行**不再写奖励明细**:`达标奖 N 书币 · 超额奖 N 书币` 太啰嗦,要查奖励看挑战详情接口的 `reachRewardCoin`/`reachRewardCard`/`extraRewardCoin`/`extraRewardCard`
- `福利` 行常驻:无可领时显示 `福利:暂无可领`,领到时把领取明细接在同一行;书币余额读到才显示 `书币余额` 与 `即将过期`,体验卡读到才显示 `体验卡 N 天`

## 挑战与余额接口

两个接口都用 App 凭据(vid + accessToken),实测于 2026-10-02:

- `GET /challenge/detail?version=v3&scene=2` —— 挑战详情,返回 `challengeList`。字段:`readTime` 单位是**秒**,`readDateList.length` 是已读天数,`challenge.targetTime`/`targetDay` 是完成条件,`challenge.challengeDay` 是总天数,`price > 0` 表示付费挑战;奖励四件套 `reachRewardCoin`/`reachRewardCard`(达标奖书币/体验卡天)与 `extraRewardCoin`/`extraRewardCard`(超额奖书币/体验卡天)
- `POST /pay/balance`,body 必须是 `{"pf":"wechat_wx-2001-android-100-weread"}` —— **`pf` 是必填**,缺了会返回 `499 -2003 参数格式错误`;返回 `balance`(总余额)、`giftBalance`(赠币)与 `expiryBalance`(即将过期)
- `GET /pay/memberCardSummary?pf=wechat_wx-2001-android-100-weread` —— 会员卡余额。`remainTime` 是会员卡总剩余秒数,`payingRemainTime` 是其中付费卡的部分,两者之差即**体验卡**剩余秒数;2026-10-03 实测差值恰为整天(259200 秒 = 3 天),与 `GET /pay/membercardexitems` 的 `remainFreeDays: 3` 互相印证。注意同一次 `/weekly/exchange` 的 `infiniteCard.day` 实测报 0,与上面两者不一致,故不采用

三者失败都只记日志与 `data/history.json`,不影响运行结果与退出码。

## 福利书币

阅读器里的「福利书币」入口在每次阅读会话结束后顺带处理一次:先查询(`action=query`),有可领的书币才领取(`action=recv`),领完再查一次自证。

- 接口:`GET https://i.weread.qq.com/reader/welfareCoin`,参数 `bookId` / `chapterUid` / `key` / `action`(`query` 查询、`get` 查详情、`recv` 领取;参数出自 APK 反汇编,2026-10-02 实测 `action=query` 返回 200)
- 依赖:`secrets/app-credentials.json` 由 `node src/app-login.js qr` 生成二维码、`node src/app-login.js wait` 扫码换取,缺它本步不执行(历史记 `reason=no-credentials`,并在运行日志里带上换取失败的原因)
- `chapterUid` 目前恒传 0:网页请求体里的 `ci`(chapter_index)/ `co`(page_number)/ `ct`(时间戳)/ `c`(十六进制 chapter_id)都不是 App 需要的整数 `chapterUid`,映射不确定就不猜(见设计文档第 8 节)
- 每次**真跑**写一行运行日志(经 `run-daily.bat` 启动时落在 `logs\last-run.log`,手工 `node src/index.js run` 则打在控制台):`[WELFARE] reason=... coin=... claimed=... verified=...`;拿不到凭据时另带一段脱敏截断的 `error=`;`--dry` 与被守卫跳过的那几次不写
- 领到:日报里出现 `福利:阅读器书币 +N`;领取后再查一次自证,若书币没归零则文案变成 `福利:阅读器书币 +N · 未自证`
- 没有可领:不推送,只写日志与 `data/history.json` 的 `welfare` 字段
- 领取失败:日报里出现 `福利:阅读器书币领取失败,下次运行重试`(每天最多一条,频率键 `welfare-claim-failed`)
- 拿不到 App 凭据时本次不查询,该条历史记录的 `welfare` 记为 `{reason: "no-credentials", ...}`(不再是 `null`)
- 接口与实测依据见 `docs/superpowers/specs/2026-10-02-welfare-coin-design.md`(本机文档,不进仓库)

## 阅读时长福利(每周阅读奖励)

「我 → 阅读时长/福利」的档位奖励在每次运行结束后顺带处理一次:查询档位 → 能领的就领 → 结果进日报。

- 接口:`POST https://i.weread.qq.com/weekly/exchange`
  - 查询体 `{awardLevelId: 0, awardChoiceType: 0, isExchangeAward: 0, isVisitReadGoal: 1, unread: 1, pf}`
  - 领取体 `{awardLevelId: <档位号>, awardChoiceType: <1|2>, isExchangeAward: 1, isVisitReadGoal: 1, unread: 1, pf}`
  - 客户端标识 `pf = wechat_wx-2001-android-100-weread`(沿用抓到的值)
- 档位:时长档 5 个(5 分钟 / 30 分钟 / 1 小时 / 3 小时 / 5 小时)+ 天数档 3 个(2 / 4 / 7 天),合计 8 档;`awardStatus` 2 = 已领取、0 = 未达成(`awardStatusDesc` 说明差多少),这两个之外的未知状态一律试领一次,失败只记日志 —— 便于将来校准
- 领取偏好:**书币优先**,书币不可选时退回体验卡
- 领到:日报出现 `福利:领取「读 1 小时」+2 书币`(体验卡档写作 `+N 天体验卡`);领取后再查一次自证,没自证上会带 ` · 未自证`
- 无档位可领:不推送,只写运行日志(`[WEEKLY] read=...s days=... claimable=N claimed=[...] failed=[...]`)与 `data/history.json` 的 `weekly` 字段;`--dry` 与被守卫跳过的那几次都不写
- 领取失败:日报出现 `福利:档位领取失败,下次运行重试`(每天最多一条,频率键 `weekly-claim-failed`);同一批里一档领到一档失败时两行都出;已领过(`errcode=-2664`)不算失败,既不报领取也不报失败
- 凭据失效:本步只写运行日志(`[WEEKLY] reason=query-failed`),不推送 —— 凭据问题统一由运行前体检负责,不重复报
- 接口依据:2026-10-02 手机抓包(该路径在 APK 里是动态拼接的,枚举与反编译都命中不了);2026-10-02 实测查询 200、8 档、`readingTime=11161` / `readingDay=3`
