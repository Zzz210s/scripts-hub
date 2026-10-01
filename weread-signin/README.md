# 微信读书每日签到:配置说明

程序本体在 `%WEREAD_DIR%`(私有仓库 `Zzz210s/weread-signin`)。本目录只放配置模板与说明。

## 这个程序做什么

自动完成微信读书阅读挑战的每日打卡(当天有效阅读 > 5 分钟),跑完用腾讯官方只读 API 校验时长是否真的被计入。

- 底座:`funnyzak/weread-bot`(MIT),在 `%WEREAD_DIR%\vendor\weread-bot`,固定 commit `0cc9b5c3`
- 本项目补的三块:读回校验、按剩余进度算每日目标、Windows 无人值守调度

## 需要的配置(真值只放在本机)

| 文件 | 内容 | 去哪拿 |
| --- | --- | --- |
| `%WEREAD_DIR%\.env` | 挑战起止日期、目标与守卫参数 | 复制本目录的 `env.example` |
| `%WEREAD_DIR%\config.yaml` | 底座的配置(书籍、目标时长区间、通知) | 复制本目录的 `config.yaml.example` |
| `%WEREAD_DIR%\secrets\read-request.curl` | 网页版 `read` 请求的 cURL | 浏览器对 `https://weread.qq.com/web/book/read` 请求 Copy as cURL (bash) |
| `%WEREAD_DIR%\secrets\weread-api-key.txt` | 官方 API Key(读回统计用) | https://weread.qq.com/r/weread-skills |
| `%WEREAD_DIR%\secrets\wecom-webhook.txt` | 企业微信群机器人 webhook | 企业微信群 → 添加群机器人 |

`config.yaml` 里的 `target_duration` 由程序每次运行时自动改写(按剩余进度算),不用手工维护。

## 常用命令

```powershell
cd %WEREAD_DIR%
node src/index.js plan          # 今天该读多久
node src/index.js run --force   # 立刻跑一次(手动,不受安静时段限制)
node src/index.js status        # 状态 + 官方统计
node src/index.js pause         # 暂停自动运行(恢复用 resume)
```

## 计划任务

`WeReadSignIn`:登录后 3 分钟触发(1 小时内每 10 分钟重试)+ 每天 08:00 起每 60 分钟一次、持续 14 小时。

```powershell
# 重新注册(换机器或任务丢失时)
powershell -ExecutionPolicy Bypass -File %WEREAD_DIR%\scripts\windows\install-autostart.ps1
# 卸载
Unregister-ScheduledTask -TaskName WeReadSignIn
```

每次触发都要过守卫:已达标 / 安静时段(20:00-23:00)/ 距 02:00 关机不足 30 分钟 / 可用内存低于 600MB / 官方统计读不到 —— 任一不满足就安静退出。细节见程序目录里的 `scripts\windows\README-autostart.md`。

## 日志与状态

| 路径 | 内容 |
| --- | --- |
| `logs\last-run.log` | 最近一次运行输出(上一次在 `previous-run.log`) |
| `logs\weread.log` | 底座日志(请求进度、成功/失败) |
| `data\state.json` | 当日状态(今日分钟、目标、尝试次数、是否达标) |
| `data\history.json` | 最近 200 次运行记录 |
| `data\paused` | 存在即暂停 |
