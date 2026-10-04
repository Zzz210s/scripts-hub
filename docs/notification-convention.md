# 通知约定:两个自动化程序共用的消息架构

本机三个无人值守程序(微软积分、微信读书签到、Epic 限免领取)都往同一个企业微信群机器人推送。
它们各自独立开发,推送风格一度完全不同 —— 这条约定把「会发哪些消息」「消息叫什么名字」
「开始消息长什么样」固定下来,避免以后再各写各的。

约定定于 2026-10-03;同日按用户反馈修订:开始消息一行化,`skip` 与 `action` 标题与正文分开。真源:

| 程序 | 通知层代码 | 企业微信 webhook |
| --- | --- | --- |
| 微软积分 | `%REWARDS_DIR%\wechat-bridge\` | `wechat-bridge\data\wecom-webhook.txt` |
| 微信读书签到 | `%WEREAD_DIR%\src\notify*.js`、`run-notice.js` | `secrets/wecom-webhook.txt` |
| Epic 限免领取 | `proj-epic-free-games/src/{notify,policy,messages}.js`、`run.js` | `secrets/wecom-webhook.txt` |

## 1. 消息类型表

**类型名统一,分工统一**;每条消息只属于一个类型。子形态(例如"结果成功"与"结果有失败")
只是同一类型的不同文案,不再另起类型名。

| 类型名 | 含义 | 微软积分 | 微信读书签到 | Epic 限免领取 |
| --- | --- | --- | --- | --- |
| `start` 开始运行 | 本次真的要跑了,run 之前发 | `wechat-bridge/notify-start.js` | `src/notify-policy.js` 的 `buildStartMessage`,由 `src/run-notice.js` 发送 | `src/run.js` 调 `messages.js` 的 `buildStartMessage` |
| `result` 运行结果 | 每次运行结束发一条:成功 / 有失败 / 中断无数据 | `wechat-bridge/notify-run.js`(排版在 `lib/report.js`) | `src/notify.js` 的 `buildReport`,由 `src/run.js` 发送 | `src/messages.js` 的 `buildResultMessage`,由 `src/run.js` 发送 |
| `skip` 正常跳过 | 触发被规则拦下,这次不跑;说清原因、会不会自动重试、不需要你做什么 | `wechat-bridge/notify-skip.js` `memory` / `handled` / `exhausted` | `src/notify-policy.js` 的 `buildSkipMessage`,reason 不属于 `action` | `src/policy.js` 的 `isSilentSkip` + `src/messages.js` 的 `buildSkipMessage`,由 `src/run.js` 发送 |
| `action` 需要你处理 | 不处理就会一直不跑,不受频率限制;正文第一句就是请你做什么 | `wechat-bridge/notify-skip.js` `nocreds` | 同上,`reason=credential-invalid` 或 `stats-unavailable` | 同上,`kind=captcha` / `login` / `blocked`;`captcha` 与 `blocked` 带预置结账链接 |

「正常跳过」还分两档(2026-10-04 定):**不需要人做任何事**的那些只写运行日志、不推送;
可能让今天白丢的那些照旧推送 —— 见下面的「静音的跳过」。

当日口径由 `result` 消息携带:它的汇总行里有「今日共 +X 分」,不再单独发一条当日汇总。
微软积分原有的 `notify-day.js` 已于 2026-10-03 删除。

### 频率限制(避免刷屏)

| 类型 | 上限 | 实现位置 |
| --- | --- | --- |
| `start` | 每次运行一条;当天最多 3 次尝试 | `scripts/windows/run-daily.bat` 的 once-per-day 守卫 + `logs/last-run.state` |
| `result` | 每次运行一条 | 每次运行后调用一次;日志里没有结论(还在跑 / 没跑完)时不发 |
| `skip` | 同一天同一种原因最多一条;**不需要人管的那些一条都不发,只写运行日志** | 微软:bat 侧的 `logs/*.notified` 标记;微信读书:`shouldNotifyOnce`;静音判断见 `isSilentSkip` |
| `action` | 每次都发,不受限制 | 微信读书 `ALWAYS_NOTIFY`;微软 nocreds 每天一条 |

例外:微信读书的 `stats-unavailable` 也在 `ALWAYS_NOTIFY` 里 —— 连续读不到统计说明
API Key 或接口有问题,不处理就永远不跑,所以按 `action` 每次都发。

### 静音的跳过(2026-10-04)

用户反馈:一天里那些「本来一切正常、不需要人做任何事」的跳过消息没必要推 —— 看多了只会
把真正的提醒一起忽略。于是按「不看会不会误事」分成两档:

| 档位 | 处理 | 原因 |
| --- | --- | --- |
| 静音 | **只写运行日志,不推送** | 微软 `handled`;微信读书 `done`、`peer-running`、`quiet-hours`;Epic `nothing-new`、`already-attempted`、`peer-running`、`quiet-hours` |
| 照旧推送 | 推一条,同因同日最多一条 | 微软 `memory`、`exhausted`;微信读书 `low-memory`、`attempts-exhausted`、`before-shutdown`、`paused`;Epic `low-memory`、`probe-failed`、`paused` |

- 静音不等于消失:文案照旧整条写进运行日志(微软 `logs\runner.log` 与 `logs\last-run.log`,
  微信读书 `logs\last-run.log` / `logs\runner.log`),事后可查「这次为什么没跑」。
- `paused` 不静音:它是只有人才能清掉的状态,消息里还带一个 `resume` 动作;留着不管会一直不跑,
  属于「不看会误事」。
- 实现:微软 `wechat-bridge/lib/skip.js` 的 `isSilentSkip(mode)`;微信读书 `src/notify-policy.js`
  的 `isSilentSkip(reason)`。两边都有单测钉住这两张表。

### `skip` 的原因词表

两边原因名各自保留(它们是程序内部的状态名),但都必须翻译成人话写进 `原因:` 行。

- 微软积分:`handled` 当天已经跑过(静音)、`memory` 内存不足、`exhausted` 尝试次数用尽、
  `nocreds` 没有配置账号(归 `action`)。
- 微信读书签到:`done` 已达标(静音)、`peer-running` 同伴在跑(静音)、`quiet-hours` 安静时段(静音)、
  `before-shutdown` 临近关机、`attempts-exhausted` 尝试用尽、`paused` 已手动暂停、
  `credential-invalid` 凭据失效、`stats-unavailable` 读不到官方统计、`low-memory` 内存不足。
- Epic 限免领取:`nothing-new` 当期免费项都领过了(静音)、`already-attempted` 今天的尝试次数用尽(静音)、
  `peer-running` 同伴在跑(静音)、`quiet-hours` 安静时段(静音)、`shutdown-soon` 临近关机(静音)、
  `low-memory` 内存不足、`probe-failed` 读免费清单失败、`paused` 已手动暂停。

## 2. 开始消息模板(`start`)

**开始消息只有一行**:`<程序名> · <账号或账号数> · <日期> · <动作>`

```
微软积分 · 5 个账号 · 2026-10-03 · 开始运行
```

```
微信读书签到 · TestReader · 2026-10-03 · 开始自动阅读
```

目标、分段、挑战、福利、第几次尝试、并行度、上次结果、触发方式都不再进开始消息
(2026-10-03 用户要求「简化成一句话告诉我哪个程序开始运行就行」)。它们落在运行日志里
(微软 `logs\last-run.log` 的 `本次口径:` 行;微信读书控制台输出与 `data/history.json`),
要看的数字由 `result` 消息给。

自动重试只留一个极短后缀,两个字:

```
微软积分 · 5 个账号 · 2026-10-03 · 开始运行 · 重试
```

### `skip` 与 `action` 的区分(2026-10-03)

两类都套「标题行 / 空行 / 正文」,但标题词与正文结构不同,一眼能分清:

```
<程序名> · <账号或账号数> · <日期> · 正常跳过

原因:<为什么这次不跑>
后续:<会不会自动重试 / 什么时候>
你需要做什么:不需要
```

```
<程序名> · <账号或账号数> · <日期> · 需要你处理

请你:<要你做的第一件事>
原因:<为什么会这样>
不处理的后果:<一直不处理会怎样>
```

- `正常跳过`:程序自己会在下一次触发重试,人不用管。最后一行固定是 `你需要做什么:不需要`。
  其中「不需要人做任何事」的那些(见第 1 节的静音表)连这条消息都不发,只写运行日志。
- `需要你处理`:不处理就永远不会自己好。正文第一句必须是 `请你:` 开头。
- 判断标准只有一条:不处理会不会一直不跑。目前「登录凭据失效」
  (微信读书 `credential-invalid`)、「读不到官方统计」(微信读书 `stats-unavailable`)
  与「没有配置账号」(微软 `nocreds`)属于 `action`;
  其余原因(已达标 / 安静时段 / 内存不足 / 当天已跑过 …… )都是 `skip`。
- 静音与类型是两回事:静音只决定「发不发」,`skip` / `action` 决定「发什么」。

### 动作词表(两边共用)

| 时机 | 动作词 |
| --- | --- |
| `start` | 微软 `开始运行` / 微信读书 `开始自动阅读` / Epic `开始领取` |
| `result` 成功 | `运行成功` |
| `result` 有失败 | `运行有失败` |
| `skip` | `正常跳过` |
| `action` | `需要你处理` |
| `result` 预览 | `预览,未运行` |

## 3. 结果消息:格式按程序自定

`result` **只要求类型名与骨架开头一致,正文自由** —— 两个程序的数据形态差太多
(微软是 5 个账号的分数表,微信读书是阅读时长 + 挑战 + 福利),硬套同一个模板只会两边都难读。

唯一必须一致的两条:

- 第一行仍然是 `<程序名> · <日期> · <动作>`,后面跟一个空行,再进正文。
- 逐条目一行、按信息密度从高到低排;解释性文字缩进跟在对应条目后面,**不要堆到末尾一大段**。

微软积分(逐账号按今日得分降序,低分原因缩进跟在账号行后,失败段单列并标出阶段):

```
微软积分 · 2026-10-03 · 运行成功

结果:5 个账号 · 本次 +200 分 · 今日共 +310 分 · 耗时 44.3 分钟
账号 user1@example.com · 今日 +120 · 本次 +120 · 累计 1500
账号 user2@example.com · 今日 +110 · 本次 +0 · 累计 1640
  原因:桌面搜索运行前已领完 · 已完成跳过 · App 侧可赚积分仅剩 5 分
账号 user3@example.com · 今日 +50 · 本次 +50 · 累计 1180
账号 user4@example.com · 今日 +30 · 本次 +30 · 累计 2450
  原因:App 侧可赚积分仅剩 5 分
账号 user5@example.com · 今日 +0 · 本次 +0 · 累计 900
  原因:桌面搜索运行前已领完 · 已完成跳过 · App 侧可赚积分仅剩 5 分
```

失败时追加(阶段名从日志标记归到 `运行器结论 / 看门狗 / 进程崩溃 / 账号异常 / 视觉搜索 / 主流程 / 致命错误`):

```
微软积分 · 2026-10-03 · 运行有失败

结果:3 个账号 · 本次 +62 分 · 今日共 +215 分
账号 user2@example.com · 今日 +110 · 本次 +0 · 累计 1640
账号 user4@example.com · 今日 +80 · 本次 +37 · 累计 2530
账号 user5@example.com · 今日 +25 · 本次 +25 · 累计 925

失败:1 条
  运行器结论 · === run finished with FAILURES, exit code 1073807364 ===
未完成:1 个账号 · user3@example.com
```

微信读书签到:

```
微信读书签到 · TestReader · 2026-10-03 · 运行成功

阅读:今日 110 分钟 · 目标 60 分钟 · 已达标
本次:凭据已自动续期
挑战:付费 30 天 · 4.6 / 30.0 小时 · 已读 3/29 天 · 剩 27 天 · 还可漏 1 天
免费 21 天 · 4.6 / 10.0 小时 · 已读 3/21 天 · 剩 18 天 · 不能再漏天数
福利:书币余额 12.50 · 即将过期 0.00 · 体验卡 3 天
```

微信读书的 `本次:` 行只保留 凭据续期 与 计入异常 / 读回失败 两种状态;两者都没有时整行不出现。
上报分钟 / 请求次数 / 结果只进运行日志与 `data/history.json` —— 结果已由标题行给出,
再报一遍只是噪音。
福利行只报 书币余额 / 即将过期 / 体验卡天数;本周档位总览与逐档领取明细不再进消息,
但领取失败与未自证照旧报出来。

## 4. 硬规则(所有文案)

- **不用圆括号**。补充说明一律用 ` · ` 分隔。原因:企业微信是纯文本,括号里的内容在手机窄屏上
  一折行就和正文糊在一起;批处理传参时括号还会被 `cmd` 当成块分隔符(踩过)。
- **不用 emoji**。
- **分隔符统一 ` · `**(中点,前后各一个空格),不要用 `|`、`;`、`,`、`-` 混着来。
- **标题行第一段是程序名**,第二段是账号或账号数,第三段是日期,第四段是动作。
- **数字口径写清楚**:本次 / 今日 / 累计 / 官方口径 各自标明,不写"又涨了"这种没有基准的说法。
- **未取到的字段不编**:读不到就少一行,不写 0、不写"未知"以外的占位。
- **缩进的解释行用两个空格开头**,只跟在它所解释的那一条下面。
- 单条消息 UTF-8 不超过 2048 字节(企业微信文本上限),超了会被发送层截断。

发送层的字节上限与安全截断、超时与重试、`errcode` 处理、发送频率见
[wecom-rules.md](wecom-rules.md);本文件只管“发什么”,那份管“怎么发”。

## 5. 加了新消息怎么办

1. 先在上面「消息类型表」里认领一个类型名;没有合适的就加一行,不要悄悄发明新类型。
2. `start` 一行套第 2 节的模板;`result` 按第 3 节的强制项自由排版;`skip` / `action`
   套第 2 节的两段模板(标题词 + 正文结构都不能混)。
3. 补一条断言文案的测试(两边都有 `test/`),把"不带圆括号"和标题行形状锁住。
4. 新的跳过原因要想清楚属于哪一档:不需要人管的写进静音表(两边各一份 `isSilentSkip` 的单测),
   不看会误事的保持推送。
