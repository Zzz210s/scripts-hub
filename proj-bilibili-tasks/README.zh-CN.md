# B站任务

[English](README.md) | 简体中文

无人值守跑 B站每日经验任务:自研的 Node 薄壳调用上游
[BiliBiliToolPro](https://github.com/RayWangQvQ/BiliBiliToolPro) 的 Console 程序,
带企业微信通知,守卫链与本仓库其它程序同一套。

## 做什么

- 跑每日经验任务:登录、观看、分享,以及每天最多 1 枚的投币(数量可在 `.env` 用 `BILIBILI_COIN_MAX` 调整)。
- 由薄壳负责年度大会员的 B币券:先查状态,该领才领,领后自证,结果并入 result 消息。
- 顺手做纯获取型任务:大会员大积分、漫画签到、漫读券。
- 不做任何消耗性或破坏性动作:花硬币、花银瓜子、批量取关、发直播弹幕、改关注分组这些任务
  都显式关闭。
- 一次运行最多两条通知:`start` 在跑之前,`result` 在跑完之后;`skip` 只写运行日志。

## 架构

```
config/schedule.json        什么时候跑(默认关闭,扫码登录后再打开)
scripts/linux/bilibili/     宿主侧运行器、Dockerfile、容器入口
proj-bilibili-tasks/
  src/cli.js                run / login / status / cookies / check / pause / resume
  src/run.js                一次运行:守卫 -> 券 -> Console -> 归类 -> 通知 -> 落状态
  src/*.js                  纯模块(member、voucher、donate、classify、messages、guards 等)
  src/notify.js             共享的 wecom-core 发送块(与其余实现逐字节一致的一份,由漂移检测锁住)
  test/*.test.js            离线测试;网络与子进程全部用桩
  scripts/windows/          Windows 备用入口
```

- 薄壳负责:守卫、券流程、**投币本身**(`src/coin.js`:查已投 → 逐条间隔 ≥1.5 秒投出 → 按经验真值校验)、退出码/stdout 特征归类、通知、本地状态。
  为什么投币自己投:上游 Console 的投币链路要逐条打 `GET /x/web-interface/view`,这个机房 IP 在 2026-10-28 被它稳定回 `-412 request was banned`,把间隔放宽到 10 秒也没用;而我们自己发同样的请求是 200,`coin/add` 也通。所以 Console 的投币被置 `NumberOfCoins=0`,改由薄壳用更轻的调用序列执行。
- 上游 Console 负责:启用任务的 B站接口调用。它以子进程方式运行,任务清单固定,
  每个任务都有显式的开/关矩阵。
- 上游源码不入库。镜像构建时按 `VENDOR_COMMIT.txt` 与
  `scripts/linux/bilibili/Dockerfile` 里记录的同一个 commit 取用。

## 前置条件

- Node.js >= 20.11(薄壳零 npm 依赖,用内置 test runner)。
- 容器内需要 .NET 10 runtime(上游 Console)。
- 构建镜像需要网络(取上游源码与基础镜像)。

## 部署

服务器上,套件根目录按 `/srv/apps/automation`:

```
mkdir -p /srv/apps/automation/bilibili/{data,logs,logs/console,secrets,deploy}
cp -r proj-bilibili-tasks/src                /srv/apps/automation/bilibili/src
cp scripts/linux/bilibili/deploy/run-once.sh /srv/apps/automation/bilibili/deploy/
cp scripts/linux/bilibili/Dockerfile         /srv/apps/automation/bilibili/Dockerfile

cd /srv/apps/automation/bilibili
docker build -f Dockerfile -t automation-bilibili:local .
```

再放凭据并做一次扫码登录:

```
printf '%s' '<你的企业微信 webhook 地址>' > /srv/apps/automation/bilibili/secrets/wecom-webhook.txt
chmod 600 /srv/apps/automation/bilibili/secrets/wecom-webhook.txt

docker compose -f /srv/apps/automation/compose.yaml run --rm -T bilibili-run login
```

控制台会打印二维码块字符与一个 `https://tool.lu/qrcode/basic.html?text=...` 链接,
用手机 B站 App 扫那个链接里的二维码。上游轮询 10 次、每次之间约 20 秒,所以窗口约 3 分钟
(2026-10-11 服务器实测);超时了就重跑一次。
登录产物写到 `secrets/cookies.json`;之后 `node src/cli.js check` 会打印会员类型、硬币余额与券状态。

`cookies.json` 就位后,容器会跟着套件队列跑。`run-all.sh` 每次触发都会调它:还没登录时第一次
以 `no-credentials` 静默退出;成功跑过之后第二次触发由 `done-today` 守卫跳过。

Windows 只是备用入口:把 `config/schedule.json` 里 `bilibili-tasks` 的 `enabled` 改成 `true`,
再跑 `node scripts/apply-schedule.mjs --apply --yes`。

## 配置

所有键都是环境变量,由 `src/config.js` 读取。除了凭据文件,一次运行不需要别的配置。常用键:

| 环境变量 | 默认值 | 含义 |
| --- | --- | --- |
| `BILIBILI_COOKIES_FILE` | `<root>/secrets/cookies.json` | 登录产物 |
| `BILIBILI_WEBHOOK_FILE` | `<root>/secrets/wecom-webhook.txt` | 企业微信通道 |
| `BILIBILI_COIN_KEEP` | `20` | 保留的硬币数;余额不高于它就不投币 |
| `BILIBILI_COIN_MAX` | `5` | 每天最多投几枚 |
| `BILIBILI_MAX_ATTEMPTS` | `2` | 一天最多真跑几次 |
| `BILIBILI_CONSOLE_TIMEOUT_MINUTES` | `20` | 薄壳侧 Console 超时 |
| `BILIBILI_FREE_MEM_MB` | `800` | 内存闸门 |
| `BILIBILI_BUSY_PEERS` | 空 | 逗号分隔的同伴锁文件 |

上游任务矩阵在 `src/console-runner.js` 里:只打开 `Daily`、`VipBigPoint`、`Manga`、
`MangaPrivilege`,其余每个任务都显式写 `Ray_*TaskConfig__IsEnable=false` 关掉。

## 验证

```
cd proj-bilibili-tasks
npm test                       # 离线,不联网、不起子进程
node src/cli.js run --dry-run  # 只打印会发什么
node src/cli.js status         # 本地状态
node src/cli.js cookies        # 只打印账号,绝不打印 cookie 值
```

在仓库根还有:`bash scripts/setup-bilibili-tasks.sh` 跑离线自检;
`node scripts/check-wecom-drift.mjs` 校验通知核心与另外五份逐字节一致。

## 诊断日志

| 路径 | 内容 |
| --- | --- |
| `logs/last-run.log` | 宿主侧最近一次运行输出(上一次在 `previous-run.log`) |
| `logs/console/log<日期>.txt` | 上游 Console 自己的 Verbose 日志 |

`logs/console` 挂到容器内的 `/app/Logs`(上游 Console 的 Serilog File sink,`rollingInterval: Day`),
容器退出不丢;宿主运行器每次跑之前清掉 30 天前的旧文件。任务“什么都没做”时先看它:
上游 `CookieTaskGuard` 曾在 nav 15 秒超时时整次跳过且退出码仍为 0,薄壳现已设
`Ray_CookieCheck__AutoCheckEnabled=false`,并把这种中途终止归类为 `guard-skipped` 而不是成功。

## 已知上游问题

| 现象 | 原因 | 我们的处理 |
| --- | --- | --- |
| `VipBigPoint` 领取失败 `6007000 请将客户端更新至最新版本` | 接口 `pgc/activity/score/task/receive/v2` 现在要 App 侧设备身份(设备字段 + 有效 `x-bili-ticket`);只用网页 cookie 时接口返回 `code=0` 但**毫无效果**(任务状态与积分不变)。上游 issue [#1195](https://github.com/RayWangQvQ/BiliBiliToolPro/issues/1195) 仍开放 | 容忍:不翻转运行结论,消息带 issue 号。有 App 凭据时可放到 `secrets/bilibili-app.json`(`{"accessKey": "...", "deviceTicket": "..."}`,权限 600),薄壳每次运行后会尝试补领,并且**只报状态差异证明的结果**(`大积分:补领 1/1 项 · 积分 +40`,或 `补领 N 项无效果`) |
| 「观看、分享视频」失败 `HttpClient.Timeout of 30 seconds`(分享的 5 点经验丢了) | 上游默认 `Security.IntervalSecondsBetweenRequestApi=20`,即**每个** GET/POST 前随机睡 10-20 秒,而这段睡眠计入 30 秒 HttpClient 超时;上游 issue [#1141](https://github.com/RayWangQvQ/BiliBiliToolPro/issues/1141) | 薄壳把间隔钉到 5 秒(`Ray_Security__IntervalSecondsBetweenRequestApi`),给 30 秒预算留 4 倍余量;实测到 `api.bilibili.com` 只有 0.12-0.16 秒,说明慢的是间隔而非网络 |

## 回滚

从 `scripts/linux/compose.yaml` 删掉 `bilibili-run` 服务,删掉 `scripts/linux/run-all.sh` 里调用
`bilibili/run.sh` 的那一段,并把 `config/schedule.json` 的 `enabled` 改回 `false`。
`data/` 与 `secrets/` 留在宿主机,重新启用时不用再登录一次。

## 许可

GPL-3.0-only。镜像按 `VENDOR_COMMIT.txt` 记录的固定 commit 从上游构建;上游来源、许可与我们的
改动声明见 `NOTICE`。镜像自用,不对外分发。

### 投币为什么自己做

上游 Console 的投币是一串「查已投 → 取视频详情 → 投币」的循环,其中 `GET /x/web-interface/view`
在机房 IP 上会被 B站 WAF 稳定拦成 `-412 request was banned`(2026-10-28 实测:连续一小时、间隔从 5 秒
放到 10 秒也一样)。而同样请求由薄壳发出是 `200`,投币接口 `coin/add` 也正常。

所以 `Ray_DailyTaskConfig__NumberOfCoins` 恒置 `0`(Console 不投),改由 `src/coin.js` 执行:
按 `exp/reward` 的今日投币经验算缺口 → 从排行榜取候选 → 每条先用 `archive/coins` 查已投(幂等)
→ `coin/add` 逐条投、间隔 ≥1.5 秒 → 达标即停。经验取不到时**不投**(宁可少投,不重复投)。
