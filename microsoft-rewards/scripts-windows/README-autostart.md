# 开机静默自启动说明(v4.3.2 本地部署)

> 路径约定:下文 `%REWARDS_DIR%` 指微软积分程序本体的安装目录(仓库根 README 有说明)。
> 脚本本身都用 `%~dp0` 相对定位,不写死盘符,所以整份 `scripts\windows\` 可以原样挪到任何路径。

本项目已配置为**开机静默自动运行、跑完自动退出**,无需人工干预;
运行**开始与结束都会推送企业微信通知**(见第四节)。

## 一、计划任务

| 项目 | 值 |
| --- | --- |
| 任务名 | `MicrosoftRewardsScript` |
| 动作 | `wscript.exe "E:\Microsoft-Rewards-Script-4.3.2\scripts\windows\run-daily.vbs"` |
| 触发 1 | 用户登录后 3 分钟(等网络就绪);**并在其后 1 小时内每 10 分钟重复一次** |
| 触发 2 | 每天 08:00,并在其后 14 小时内每 2 小时重复一次 |
| 窗口 | 隐藏(无黑框弹出) |
| 权限 | 当前用户、非管理员、仅登录时运行(不保存密码) |

触发 1 的重复是 2026-09-24 加的:原先只有"登录后 3 分钟"这一次机会,如果机器在
那 3 分钟内又睡了(2026-09-21 实测:08:19:23 开机 → 08:20:58 又进睡眠),
这次触发就白丢,下一次要等到 2 小时后的定时重复 —— 用户看到的就是"开机后迟迟不跑"。
重复的 6 次里,已跑完的那天会被“一天只跑一遍”规则一秒跳过,几乎不花代价。

还有一个配套任务,负责每天凌晨把机器真正关掉:

| 项目 | 值 |
| --- | --- |
| 任务名 | `AutoShutdown0200` |
| 动作 | `wscript.exe "E:\Microsoft-Rewards-Script-4.3.2\scripts\windows\run-shutdown.vbs"` |
| 触发 | 每天 02:00(**唤醒计算机执行**,错过不再补跑) |
| 脚本 | `scripts\windows\auto-shutdown.bat`(隐藏运行),日志 `logs\shutdown.log` |
| 行为 | **无条件真关机**:`shutdown /s /f /t 60` —— 不等奖励脚本,但保留 60 秒缓冲(期间 `shutdown /a` 可撤销) |
| 注销 | `Unregister-ScheduledTask -TaskName AutoShutdown0200 -Confirm:$false` |

2026-09-24 之前是 04:00(任务名 `AutoShutdown0400`,已注销),按使用习惯改到了 02:00。
注意“逻辑日”的分界仍然是 **04:00**(见第二节):02:00 关机后、04:00 之前的那段
即便机器被人重新打开,运行也只会计入前一天,不会吃掉新的一天。

为什么需要它:这台机器平时只进睡眠不关机,日子久了内存被各种常驻进程吃满
(实测提交内存能到物理内存的两倍),奖励脚本就在换页里爬行。凌晨真关机一次,
第二天开机时状态干净,奖励脚本也会在开机触发里跟着跑一遍。
若想改成"到点立刻关机"(没有撤销窗口),把 bat 里的 `/t 60` 改成 `/t 0`。
注意 `StartWhenAvailable=False`:凌晨那次如果错过了(例如断电、睡眠期间唤醒定时器被关),
**不会**在你早上开机后补一次关机 —— 否则开机就会被立刻关掉。

触发 2 的重复很关键:脚本如果中途被异常中断(浏览器渲染器崩溃、被强杀、断电),
下一次重复触发会在当天自动重试(一天最多 3 次尝试),不需要人工干预;
已完成的当天会被“一天只跑一遍”规则拦下,重复触发只是一秒级的空跑。
任务设置已确认:允许电池启动、不因断电停止、不限制空闲、执行时限 72 小时、重复实例忽略。

注:早期曾注册过一个常驻任务 `WeChatClawBotBridge`(微信 ClawBot 长轮询桥),
已随微信通道一起**删除**(任务已注销、脚本已移除),现在只有上面这一个计划任务。

## 二、"一天只跑一遍"规则

由 `scripts\windows\run-daily.bat` 自己保证,状态写在 `logs\last-run.state`:

- 文件内容格式:`YYYY-MM-DD N`
  - **真正跑完**(日志里出现 `[ACCOUNT-END]`;或 `[ACCOUNT-SKIP]`,即遇到 bot 风控主动收手):写 `YYYY-MM-DD 9`,当天后续所有触发直接跳过
  - **失败**:`N` 累加,最多尝试 3 次;到 3 次后当天也不再触发。**失败不会锁死当天**,所以后续触发还会重试
- 判失败的依据不止退出码:上游脚本即使登录/流程挂掉也照样 `exit 0`,所以运行器还会扫描日志,出现
  `Mobile flow failed for` / `[ACCOUNT-ERROR]` / `[CLUSTER-WORKER-ERROR]` / `Fatal error:`,
  或整轮没有任何 `[ACCOUNT-END]`/`[ACCOUNT-SKIP]` 时,一律判为失败(退出码返回 1,计划任务里能看到失败)
- 第二天日期不匹配,自动重置从 0 开始
- **“天”以本地 04:00 为界(逻辑日)**:04:00 之前的运行算作前一天。
  这是 2026-09-24 事故的修复:凌晨 02:19 的一次补跑(它其实属于 09-23 那天)
  把 `2026-09-24` 写成了已完成,于是当天 11:30 开机后的 11:33/11:34/12:00 三次触发
  全部被跳过,用户一整天没看到运行。现在凌晨的运行只会计入前一天,
  开机后的那次触发必定是新一天的第一跑。日期由 `run-state.js clock` 计算
  (测试:`node --test scripts\windows\run-state.test.js`,可用 `REWARDS_NOW` 伪造“现在”)。
- **被跳过时会推送一条通知**(同一天只推一次):说明今天已经跑过、已入账多少分。
  以前跳过是**一声不响**的,用户只能猜为什么开机后没动静。
- 单实例锁 `logs\run.lock`:由运行器创建、正常结束时删除。**判定以进程为准**(是否有 node 在跑 `dist\index.js`),
  而不是只看锁文件 —— 上次被异常中断时残留的锁会被判为 `STALE` 并**立即回收**,
  否则当天所有重试会被白白挡掉(曾经出现过这个 bug:崩溃后残留锁挡住了一整天)。
  判定逻辑在 `scripts\windows\run-state.js`,可用 `node scripts\windows\run-state.js lock-status` 手动查看(NONE/RUNNING/STALE)。
- 守卫类消息(清掉残留锁、跳过原因)写在 `logs\runner.log`(不随日志轮转,便于事后查)。

## 二之二、看门狗(卡死运行会被强杀并通知)

脚本偶尔会"假活":进程还在、日志十几分钟一行不写,浏览器页面请求全部超时。
2026-09-23 实测过一次:晚上 20:16 开跑,到 22:30 只完成 1 个账号、日志停滞 30 分钟以上。

- 每次真实运行前,运行器会在后台启动 `scripts\windows\run-watchdog.bat`(默认 150 分钟,
  可用环境变量 `REWARDS_RUN_TIMEOUT_MIN` 覆盖)
- 到点后如果**同一次运行**还在,就把整棵进程树(含 headless Chromium)杀掉,
  并往 `logs\last-run.log` 写一行 `[WATCHDOG] run killed after N minutes (killed=K)`
- 被强杀的运行**不算当天完成**(即使已经跑完部分账号),这样当天剩下的触发还会重试;
  企业微信会收到一条说明"运行超时被中止"的通知(含已完成账号的得分)
- 看门狗只认自己启动时那把锁的时间戳:运行早已结束、或已经换成新的一次运行,它都不动手

## 二之三、内存闸门与自适应集群

上游每个账号会开"移动 + 桌面"两个 headless Chromium,`clusters=2` 时同时有 4 个浏览器。
本机内存常被其它程序占满(实测提交内存 34 GB 对 15.7 GB 物理内存,页面文件吃掉 13 GB),
这时并行只会互相拖慢,并伴随大量 30 秒页面超时与十几分钟的静默卡死。

每次真实运行前,`scripts\windows\run-config.js decide` 会看可用内存,给出三种决定:

| 可用内存 | 决定 | 效果 |
| --- | --- | --- |
| >= 2500 MB | `2` | 写 `config.json` 的 `clusters=2`,两个账号并行 |
| 1200 - 2499 MB | `1` | 写 `clusters=1`,降为单集群(两个浏览器) |
| < 1200 MB | `SKIP` | **不启动**:日志写一行到 `logs\runner.log`,企业微信当天只提醒一次,不消耗当天的尝试次数 |

- 日志里会留一行证据:`free memory 554MB -> clusters=1`
- 阈值可用环境变量覆盖:`REWARDS_FREE_MB_FOR_PARALLEL`、`REWARDS_MIN_FREE_MB`
- 注意:上游的 `CONFIG_CLUSTERS` 环境变量在本版本里是**死代码**
  (`src/util/ConfigEnvOverrides.ts` 的 `ENV_OVERRIDES` 没有任何调用点),所以只能改 `config.json`;
  写入走临时文件 + 改名,不会写坏配置
- 手动指定:`node scripts\windows\run-config.js clusters 2`
- 如果本次运行前发现残留锁,开始提醒会额外带一行"上次运行异常中断(未推送结果),本次为自动重试"。

**别在 bat 里传中文参数**:批处理文件是 UTF-8,而 cmd 按 GBK 解析 ——
实测多字节字的尾字节会吃掉参数末尾的引号,连 `>>` 重定向都会被吞进参数里。
所以提示文字都写在 `wechat-bridge\notify-*.js` 里(UTF-8,由 Node 读),bat 只传数字和开关。

所以一天内多次开机、或登录触发与 08:00 触发同时存在,都只会真正运行一遍。

另有一道**凭据闸门**:`.env` 不存在、或仍含示例账号(`email@example.com` / `email_2@example.com`)时,
真实运行会被直接跳过并在日志里记一行,不会消耗当天的尝试次数,也不会拿假账号去登录。
`run-daily.bat dry` 不受此闸门限制。

## 三、日志

| 文件 | 说明 |
| --- | --- |
| `logs\last-run.log` | 最近一次运行的完整输出(每次真正运行前自动轮转) |
| `logs\previous-run.log` | 上一次运行的输出(被轮转下来的) |
| `logs\last-run.state` | 一次性运行状态(见上) |
| `logs\runner.log` | 运行器守卫记录(跳过原因、残留锁回收),只追加不轮转 |
| `logs\run.lock` | 单实例锁(存在不代表在跑,以 `run-state.js lock-status` 为准) |

## 三之二、运行时长与调优

单账号耗时主要集中在“读文章赚积分”(10 篇,篇间等待)与搜索间隔。已按下列配置调优:

**实测对比(2026-09-21,5 个账号)**

| 指标 | 调优前(2026-09-20,4 账号) | 调优后(2026-09-21,5 账号) |
| --- | --- | --- |
| 总耗时 | 50.8 分钟 / 4 账号 | **32.8 分钟 / 5 账号** |
| 单账号均摊 | 约 12.7 分钟 | **约 6.6 分钟** |
| 单账号实测区间 | — | 5分47秒 ~ 18分34秒(新账号带引导任务时偏长) |
| 本次得分 | +215 | **+712**(含一个新账号的 +420) |

主要耗时块(实测):读文章 10 篇约 5-6 分钟/账号;桌面搜索约 4.6 次、每次约 75 秒(含等待、停留、随机点击)。

| 配置项 | 原值 | 现值 | 说明 |
| --- | --- | --- | --- |
| `clusters` | 1 | **2** | 两个账号并行(各一个浏览器上下文);账号越多收益越大 |
| `searchSettings.readDelay` | 30s-1min | **15s-30s** | 读文章篇间等待(10 篇,占单账号约一半时间) |
| `searchSettings.searchDelay` | 30s-1min | **20s-40s** | 搜索之间的等待 |
| `accountDelay` | 1-3min | **30s-1min** | 账号之间的停顿 |
| `workers.doBonusSearches` | true | **false** | 实测 8/8 次 `pointsGained=0`,纯浪费;要恢复就把此项改回 true |

风险提示:并行度与等待时间都影响“像不像真人”。当前是折中值(仍保留随机滚动与随机点击)。
若某天出现搜索不计分、弹出人机验证,先把 `clusters` 调回 1、把两个 delay 调回 30s-1min。
“读文章”篇数(10)写在上游源码里(`src/functions/activities/app/ReadToEarn.ts`),不是配置项。

## 三之三、每日集(30 分/账号/天)的修复

每日集 3 个条目(`Gamification_DailySet_ZHCN_<日期>_Child1..3`,每个 10 分)只有在奖励页
`/earn` 的 Next.js flight 数据里才带 `hash`(提交动作必需)。而 `/earn` 是每个账号各自抓取的:
并行运行(`clusters=2`)时偶发 `socket hang up` 会让这次抓取失败,快照里只剩 `/dashboard` 的内容,
这 3 项就被判为“页面快照里不存在”而跳过 —— 每天白丢 30 分/账号。

修复(2026-09-21):

1. `/earn` 与 `/dashboard` 的 HTML 抓取失败时会**重试一次**(纯 HTTP 与浏览器请求两条路径都重试);
2. 执行活动前若快照里找不到该 offer,会在 1.2 秒后**再刷新一次快照**再放弃;
3. 新增诊断行,便于事后确认到底有没有拿到每日集数据:

```
[EARN-SNAPSHOT] Source /earn via http | bytes=394593 | offers=0 | dailySetItems=yes | dailyIds=4
```

若某次抓取缺少 `dailySetItems`,该页 HTML 会存到 `logs\diag-snapshot-<route>.html` 供排查。

实测效果:修复前 5 账号并行运行里,有的账号 3 项全被跳过;修复后同一账号 3 项全部完成
(日志里可见 `Completed UrlReward | offerId=Gamification_DailySet_..._Child1 | pointsGained=10`,共 +30)。

## 四、运行通知(企业微信)

每次真实运行会推送**两条**消息,均由 `scripts\windows\run-daily.bat` 自动调用:

| 时机 | 脚本 | 消息内容 |
| --- | --- | --- |
| 运行开始(真正跑奖励脚本之前) | `wechat-bridge\notify-start.js` | 开始时间 + 当天第几次尝试 + 账号数 + 预计耗时 |
| 运行结束 | `wechat-bridge\notify-run.js` | 每个账号本次得分与累计积分 + 总耗时;当天跑过多次时逐账号行改为“今日 +X 分(本次 +Y)”;失败时给出失败原因与失败条目数 |

- 通道:**企业微信群机器人 webhook**(腾讯官方,无 24 小时窗口、无条数上限)。
  webhook 地址写在 `wechat-bridge\data\wecom-webhook.txt`(位于 .gitignore 覆盖目录,不入版本库)。
- 微信 ClawBot(iLink)通道已于 2026-09-20 **彻底移除**(代码、凭据、常驻任务、`channels.json` 开关全部删掉)。
  原因:它的 `context_token` 只在用户 24 小时内给机器人发过消息时有效,过期后主动推送必然失败(`sendmessage ret=-2 prepare failed`),
  不适合无人值守推送。现在通知只走企业微信。
- 目录名 `wechat-bridge` 是历史名称(先建的微信桥),现在只放**企业微信通知**相关代码与配置。
- 通知失败**不影响**运行结果与退出码;日志里会留下 `推送失败:...` 一行。
- `dry` 模式(链路自检)不发送任何通知。
- 手动验证两条通知:

```bat
node "wechat-bridge\notify-start.js" --note "手工测试"
node "wechat-bridge\notify-run.js" "logs\previous-run.log"
node "wechat-bridge\notify-run.js" --dry                     (只预览,不发送)
node "wechat-bridge\push.js" "任意内容"
```

## 五、常用命令

```bat
:: 立刻手动跑一次(可见窗口,便于观察)
E:\Microsoft-Rewards-Script-4.3.2\scripts\windows\run-daily.bat

:: 静默跑一次(与开机时完全一致的隐藏方式)
wscript.exe "E:\Microsoft-Rewards-Script-4.3.2\scripts\windows\run-daily.vbs"

:: 只验证脚本链路,不登录任何账号
E:\Microsoft-Rewards-Script-4.3.2\scripts\windows\run-daily.bat dry

:: 重新注册 / 删除开机自启动
E:\Microsoft-Rewards-Script-4.3.2\scripts\windows\install-autostart.bat
E:\Microsoft-Rewards-Script-4.3.2\scripts\windows\uninstall-autostart.bat

:: 查看任务详情
schtasks /query /tn "MicrosoftRewardsScript" /v /fo LIST
```

想改每日触发时间,编辑 `install-autostart.bat` 里的 `-At '08:00'` 后重新运行一次即可。

## 六、账号与配置

- 账号写在项目根目录 `.env`(从 `env.example` 复制),一个账号一组 `ACCOUNT_N_*`;
  改了 `.env` **无需重新构建**,下次运行即生效。
- 常规配置在项目根目录 `config.json`(从 `config.example.json` 生成)。
  当前已设 `headless: true`(静默必需)、`errorDiagnostics: true`、
  `searchSettings.queryEngines: ["local"]`(google/reddit/hackernews 在本机网络不可达)、
  `proxy.queryEngine: false`。
- 脚本必须从项目根目录运行(`run-daily.bat` 已自动 `cd` 到根目录),
  因为 `.env` / `config.json` 按当前工作目录查找。

## 七、升级上游版本

```bat
:: 下载新版本 tar.gz 后解压替换项目文件,保留 .env、config.json 与 logs\ 即可
npm run pre-build
npm run build
```

`scripts\windows\` 下的自启脚本与上游无关,升级时保留;若新版本目录变化,重新跑一次
`install-autostart.bat` 更新计划任务里的路径。
