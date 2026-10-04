# Epic 限免自动领取

[English](README.md) | **简体中文**

每周四自动领取 Epic 游戏商城的限时免费游戏,结果推到企业微信;被 hCaptcha 挡住时退化成
推送一条预置好的结账链接,不做无意义的原地重试。

领取引擎是 [vogler/free-games-claimer](https://github.com/vogler/free-games-claimer)
(AGPL-3.0),逐字节收编在 `vendor/free-games-claimer/`。本项目补了它没有的四件事:

1. **先探测再领取** —— 免费清单接口不需要登录、不碰购买链路,所以只有存在没领过的项才启动浏览器。
   一天探测几次的成本几乎为零。
2. **本地去重状态** —— 哪些已经领过、今天真跑了几次、今天推过哪条通知;已领或已在库的游戏不会再碰。
3. **按共享规则发企业微信** —— 与另两个项目同一块 `wecom-core` 发送核心,
   由 `scripts/check-wecom-drift.mjs` 锁住逐字节一致。
4. **退化路径** —— 出现 hCaptcha 时推预置结账链接,而不是反复撞墙。Epic 的限免过期不能补领,
   所以「稍后重试」没有意义。

## 背景

- 换挡是**每周四 11:00 美东**。因为美国夏令时,这个时刻在夏天是 `15:00Z`、冬天是 `16:00Z`
  —— 对应北京时间的周四 23:00 与周五 00:00。本项目不写死北京时刻,按时区算,并对齐接口自身
  返回的 `startDate`/`endDate`。
- 年度 **Holiday Sale** 期间(大致 12-10 至 01-07)每天一个免费游戏、只挂 24 小时。
  `config/schedule.json` 里留了把间隔缩短的位置。
- 结账环节有 hCaptcha(`errors.com.epicgames.purchase.purchase.captcha.challenge`),所以要有退化路径,
  也是上游引擎故意跑**有界面**浏览器的原因。

## 怎么工作

```
src/
  cli.js        命令行:run / probe / status / link / login / report / pause / resume
  run.js        一次运行:守卫 -> 探测 -> 去重 -> 通知开始 -> 引擎 -> 归类 -> 通知
  probe.js      唯一主动发 HTTP 的地方:取免费清单并解析
  promo.js      当期/预告判定、商店 slug、预置结账链接            (纯函数)
  clock.js      美东换挡点与 Holiday Sale 窗口                    (纯函数)
  state.js      已领记录、当日尝试次数、同因同日通知、剪枝
  classify.js   上游 lowdb 状态 + stdout 特征 -> 每款游戏的结论    (纯函数)
  messages.js   四条消息正文                                      (纯函数)
  policy.js     哪些跳过静音、哪些需要人处理                      (纯函数)
  guards.js     本地段守卫:暂停/尝试/同伴/安静时段/关机/内存      (纯函数)
  notify.js     企业微信发送:wecom-core 块 + 脱敏 + webhook 读取
  engine.js     以子进程跑上游引擎;读它写的 lowdb 结果
  lock.js       单实例锁与同伴互查
scripts/windows/  计划任务入口(run-daily.bat/.vbs、run-state.js、注册脚本)
test/             离线单测,不联网、不起浏览器
vendor/free-games-claimer/  上游引擎,未改一行
```

一次运行分两段。第一段纯本地:已暂停、尝试次数用尽、同伴在跑、安静时段、距 02:00 关机不足 30 分钟、
可用内存不足 —— 任一命中就直接退出,不碰网络。第二段先取免费清单(不需要登录),与本地记录比对,
**只有存在没领过的项才启动浏览器引擎**。

## 前置条件

- Node.js >= 20.11(用到 `import.meta.dirname` 与内置 test runner)
- 一个 Epic 账号,**人工登录一次**;不保存密码
- 真跑需要引擎自己的依赖:`patchright` 与它的 Chromium(`npm install` + `npx patchright install chromium`)
- 企业微信群机器人 webhook(可选;没有就不推送)
- 机器处于已登录的图形会话(上游故意让浏览器可见)

## 安装

```bash
# 1. 引擎依赖(测试不需要)
npm install
npx patchright install chromium

# 2. 人工登录一次,不保存任何密码
node src/cli.js login          # 打开浏览器,登录后关闭即可

# 3. 可选:企业微信 webhook
mkdir -p secrets
# secrets/wecom-webhook.txt   群机器人地址

# 4. 注册计划任务(在仓库根目录跑)
node scripts/apply-schedule.mjs --apply --yes
```

`config/schedule.json` 里 `epic-free-games.enabled` 默认是 `false`,人工登录过之后再打开。

## 用法

```bash
node src/cli.js probe            # 看当期与预告的免费游戏,不登录
node src/cli.js status           # 本地状态与今日尝试次数
node src/cli.js link 1           # 第 1 款游戏的预置结账链接
node src/cli.js login            # 打开浏览器人工登录
node src/cli.js run              # 跑一次,过守卫
node src/cli.js run --dry-run    # 只报告会发什么,不联网不起浏览器
node src/cli.js report           # 打印状态摘要
node src/cli.js pause / resume   # 暂停 / 恢复无人值守运行
npm test                         # 离线单测
```

## 配置

环境变量,都可选:

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `EPIC_DIR` | 本目录 | 项目根;只有把项目挪出仓库时才需要 |
| `EPIC_LOCALE` / `EPIC_COUNTRY` | `zh-CN` / `CN` | 探测用的商店语言与区域 |
| `EPIC_MAX_ATTEMPTS` | `2` | 当天真跑几次后其余触发静音 |
| `EPIC_ENGINE_TIMEOUT_MINUTES` | `30` | 单次浏览器引擎的硬上限,到点强杀进程树 |
| `EPIC_BUSY_PEERS` | 空 | 同伴程序的锁文件,逗号分隔;90 分钟内写过就让路 |
| `EPIC_DRY_RUN` | `0` | 同 `--dry-run` |
| `WECOM_WEBHOOK_FILE` | `secrets/wecom-webhook.txt` | 群机器人 webhook 位置 |

## 通知策略

一次运行最多两条:真要领时一条 `start`,结束时一条 `result` 或 `action`。
不需要人管的跳过只写日志;可能白丢当天游戏的跳过同因同日推一条。
遇到 hCaptcha 或登录态失效时,`action` 会逐款给出预置结账链接。
文案规则见 `docs/notification-convention.md`,发送规则见 `docs/wecom-rules.md`。

## 无人值守(Windows)

`scripts/windows/run-daily.bat` 是入口:单实例锁 -> 当日配额 -> 内存闸门 -> `node src/cli.js run`;
由 `run-daily.vbs` 隐藏窗口启动。注册走 `config/schedule.json`
(守卫表见 `scripts/windows/README-autostart.md`)。

## 测试

```bash
npm test          # node --test test/*.test.js
```

测试全部离线:免费清单接口、浏览器引擎、企业微信发送都是注入的桩,
不需要账号、网络与浏览器。夏令时边界、按字节截断、重试与 errcode 处理都有断言钉住。

## 已知限制

- 引擎会弹出**可见**的浏览器窗口(上游:无头模式更容易触发 hCaptcha),计划任务跑到时桌面上会出现一个窗口。
- 自动结账可能违反 Epic 的服务条款,存在账号风险。
- hCaptcha 仍可能挡住结账;那是退化路径要处理的情形,不是故障。
- 区域限制的游戏领不到;程序如实报告,不绕区。
- Windows 运行器脚本只在 Windows 可用。

## 许可与来源

本目录按 **AGPL-3.0-only**(见 `LICENSE`、`NOTICE`):它收编并衍生自
`vogler/free-games-claimer`(AGPL-3.0)。上游快照与固定 commit 记在 `VENDOR_COMMIT.txt`
与 `vendor/free-games-claimer/UPSTREAM.md`。本仓库其余部分为 GPL-3.0;GPLv3 §13 允许两者组合。
