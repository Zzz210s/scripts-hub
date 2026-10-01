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

## 每次触发要过的守卫(任一不满足就安静退出)

| 顺序 | 条件 | 结果 |
| --- | --- | --- |
| 1 | 已有同一次运行在跑(锁) | 退出;残留锁(崩溃/断电)立即回收 |
| 2 | 今天已达标(`data/state.json` 的 `done`) | 退出,不打扰 |
| 3 | 今天已尝试 3 次 | 退出 |
| 4 | 处于安静时段(默认 20:00-23:00) | 退出,避免影响真实阅读 |
| 5 | 距关机不足 30 分钟(关机时刻默认 02:00) | 退出,避免跑一半被关机掐断 |
| 6 | 可用内存低于 600MB | 退出,等下一次触发 |
| 7 | 同伴程序(微软积分)正在运行 | 退出,错峰;约定见配置方案仓库的 `tasks/scheduling-convention.md` |
| 8 | 凭据失效且自动续期也失败 | 退出,并推送「需要重新登录」 |
| 9 | 官方统计读不到 | 退出并推送一条提醒 |

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
