# 无人值守说明(计划任务与守卫)

## 什么时候跑

正规入口是合集层的调度配置 `config/schedule.json`(字段说明在 `config/schedule.example.json`):

```bash
cd <仓库根>
node scripts/apply-schedule.mjs --dry-run        # 看生成的触发器
node scripts/apply-schedule.mjs --apply --yes    # 真注册
```

本程序的默认值:任务名 `EpicFreeGames`,**09:00** 起每 **240** 分钟一次、窗口 **14** 小时,
登录后 **17** 分钟触发(微软积分 08:00 / 3 分钟,微信读书 08:30 / 10 分钟),一天最多真跑 **2** 次。
配置里 `enabled` 默认 `false` —— **人工登录过一次之后再打开**。

`scripts/windows/install-autostart.ps1` 是备用入口(离线可用),阈值与上面一致,注册出来的任务默认禁用。

为什么频率是 4 小时而不是每小时:限免是按周(周四 11:00 美东换一批)、Holiday Sale 期间才每天换,
一天跑几次足够;而探测本身不登录也不碰购买链路,多跑几次也不会被风控盯上。

## 每次触发要过的守卫

**第一段(本地,不联网)** —— 命中就在 `run-daily.bat` 或 `src/guards.js` 里直接退出:

| 顺序 | 条件 | 结果 |
| --- | --- | --- |
| 0 | 已有同一次运行在跑(`logs/run.lock`,在 .bat 里判) | 退出;残锁按进程实况立即回收 |
| 1 | 程序被手动暂停(`data/state.json` 的 `paused`) | 退出,并推一条「已手动暂停」 |
| 2 | 今天已真跑 2 次 | 退出,静音 |
| 3 | 同伴程序在跑(`EPIC_BUSY_PEERS` 列的锁文件 90 分钟内写过) | 退出,静音 |
| 4 | 安静时段(默认 20:00-23:00) | 退出,静音 |
| 5 | 距 02:00 关机不足 30 分钟 | 退出,静音 |
| 6 | 可用内存低于 800MB(.bat 里判) | 退出,推一条「可用内存不足」 |

**第二段(联网)**:取免费清单(不需要登录、约几百 KB)→ 与本地已领记录去重。
**没有没领过的项就直接退出,不启动浏览器**。有才:发 `start` → 跑引擎 → 归类 → 发 `result`
或 `需要你处理`。

## 没有单独看门狗的原因

唯一的长步骤是浏览器引擎,它由 `src/engine.js` 自己限时(`EPIC_ENGINE_TIMEOUT_MINUTES`,默认 30 分钟),
到点强杀整棵进程树;探测有 20 秒超时。所以不需要 `.bat` 侧再看一只表 —— 上游引擎被杀后
下次触发会重新来判断(已领过的项不会重复领)。

## 日志与状态

| 路径 | 内容 |
| --- | --- |
| `logs\last-run.log` | 最近一次运行的输出(每次运行前把旧的挪到 `previous-run.log`) |
| `logs\runner.log` | 运行器的判定(跳过原因、内存值) |
| `logs\run.lock` | 单实例锁(JSON,含 pid 与开始时间) |
| `data\state.json` | 已领记录、当天尝试次数、今天推过哪条通知、暂停位 |
| `data\browser\` | patchright 持久化浏览器 profile(登录态在这里,不含密码) |
| `vendor\free-games-claimer\data\epic-games.json` | 上游引擎自己写的领取结果(lowdb) |

## 常用命令

```powershell
node src\cli.js probe            # 看当期与预告的免费游戏(不登录)
node src\cli.js status           # 本地状态与今日尝试次数
node src\cli.js link 1           # 打印第 1 款游戏的预置结账链接
node src\cli.js login            # 打开浏览器人工登录一次
node src\cli.js run --dry-run    # 只报告会发什么,不联网不起浏览器
node src\cli.js pause            # 暂停 / node src\cli.js resume 恢复
node scripts\windows\run-state.js lock-status   # NONE | RUNNING | STALE
node scripts\windows\run-state.js kill          # 杀掉正在跑的引擎
```

## 为什么会有浏览器窗口

上游把 `headless` 写死为 `false`(注释原话:`SHOW=0 will lead to captcha`)——
无头模式更容易触发 hCaptcha。所以真跑时桌面上会出现一个 patchright 浏览器窗口,
这是刻意的反机器人措施,不是故障。机器需要处于已登录的图形会话。
