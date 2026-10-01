# 本机计划任务清单(2026-10-01)

与"自动化程序"相关的任务,以及它各自的作用与停用方法。

| 任务名 | 状态 | 触发 | 作用 | 停用 / 删除 |
| --- | --- | --- | --- | --- |
| `MicrosoftRewardsScript` | Ready | 登录后 3 分钟(其后 1 小时内每 10 分钟重复)+ 每天 08:00 起每 2 小时一次(14 小时窗口) | 跑微软积分脚本,一天最多 3 次尝试,完成当天即锁 | `Disable-ScheduledTask -TaskName MicrosoftRewardsScript` / `Unregister-ScheduledTask -TaskName MicrosoftRewardsScript` |
| `AutoShutdown0200` | Ready | 每天 02:00(WakeToRun=True) | 无条件真关机:`shutdown /s /f /t 60`(60 秒内 `shutdown /a` 可撤销) | `Disable-ScheduledTask -TaskName AutoShutdown0200` / `Unregister-ScheduledTask -TaskName AutoShutdown0200` |
| (待建) 微信读书签到 | - | 未定 | 每天按缺口跑阅读上报 | - |

## 查看与操作命令

```powershell
# 看状态与上次结果
Get-ScheduledTask -TaskName MicrosoftRewardsScript | Get-ScheduledTaskInfo
# 立刻手动触发一次
Start-ScheduledTask -TaskName MicrosoftRewardsScript
# 看今天是否已经跑过(9 = 已完成)
Get-Content %REWARDS_DIR%\logs\last-run.state
```

## 说明

- 两个任务都是"仅当前用户、交互式、有限权限",不存密码,重启后仍在任务库里。
- 微软积分任务的每次触发都要过守卫:内存不足(<1200MB)跳过、当天已完成跳过、安静时段与关机前 30 分钟跳过。
- 微信读书签到任务建成后在此表补一行。
