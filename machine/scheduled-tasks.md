# 本机计划任务清单(2026-10-01)

这台机器上现在装着的、与自动化程序相关的 Windows 计划任务,以及各自的作用与停用方法。
调度规则本身(错峰槽位、两段守卫)见 `../docs/scheduling-convention.md`。

| 任务名 | 状态 | 触发 | 作用 | 停用 / 删除 |
| --- | --- | --- | --- | --- |
| `MicrosoftRewardsScript` | Ready | 登录后 3 分钟(其后 1 小时内每 10 分钟重复)+ 每天 08:00 起每 2 小时一次(14 小时窗口) | 跑微软积分脚本,一天最多 3 次尝试,完成当天即锁 | `Disable-ScheduledTask -TaskName MicrosoftRewardsScript` / `Unregister-ScheduledTask -TaskName MicrosoftRewardsScript` |
| `WeReadSignIn` | Ready | 登录后 10 分钟(1 小时内每 10 分钟重试)+ 每天 08:30 起每 60 分钟一次(14 小时窗口) | 跑微信读书阅读会话,并用官方 API 校验是否计入 | `Disable-ScheduledTask -TaskName WeReadSignIn` / `Unregister-ScheduledTask -TaskName WeReadSignIn` |
| `AutoShutdown0200` | Ready | 每天 02:00(WakeToRun=True) | 无条件真关机:`shutdown /s /f /t 60`(60 秒内 `shutdown /a` 可撤销) | `Disable-ScheduledTask -TaskName AutoShutdown0200` / `Unregister-ScheduledTask -TaskName AutoShutdown0200` |

三个任务都是「仅当前用户、交互式、有限权限」,不存密码,重启后仍在任务库里。智慧树刷课没有计划任务
(手动运行)。

## 查看与操作命令

```powershell
# 看状态与上次结果
Get-ScheduledTask -TaskName MicrosoftRewardsScript | Get-ScheduledTaskInfo
# 立刻手动触发一次
Start-ScheduledTask -TaskName MicrosoftRewardsScript
# 看今天是否已经跑过(9 = 已完成)
Get-Content $env:REWARDS_DIR\logs\last-run.state
```

## 每次触发要过的守卫

两个自动任务都要过同一套守卫,定义见 `../docs/scheduling-convention.md`:

- 微软积分:内存不足(<1200MB)跳过、当天已完成跳过、安静时段与关机前 30 分钟跳过。
- 微信读书签到:已达标(`data\state.json` 的 `done`)/ 尝试次数 / 同伴在跑 / 安静时段(20:00-23:00)/
  距 02:00 关机不足 30 分钟 / 可用内存低于 600MB / 官方统计读不到。手动运行用
  `node src/index.js run --force` 可跳过安静时段。
