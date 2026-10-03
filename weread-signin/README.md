# 微信读书签到:本机部署说明

程序本体不在本仓库。权威来源是 **[Zzz210s/weread-signin](https://github.com/Zzz210s/weread-signin)**(MIT):
源码、配置模板、调度脚本、用量说明都在那里。本目录只保留「这台机器上怎么跑」的说明,不再放任何副本,避免同一份内容有两个出处。

## 这个程序做什么

自动完成微信读书阅读挑战的每日打卡(当天有效阅读 > 5 分钟),跑完用腾讯官方只读 API 校验时长是否真的被计入。

- 底座:[`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot)(MIT),固定在权威仓库的 `vendor/` 下,commit 记在它的 `VENDOR_COMMIT.txt`
- 权威仓库自己补的三块:读回校验、按剩余进度算每日目标、Windows 无人值守调度

## 部署步骤(权威做法以 Zzz210s/weread-signin 的 README 为准)

```powershell
# 1. 克隆到 %WEREAD_DIR%(路径约定见仓库根 README)
git clone https://github.com/Zzz210s/weread-signin.git %WEREAD_DIR%

# 2. 在 %WEREAD_DIR% 里复制配置模板
#    .env.example -> .env,config.yaml.example -> config.yaml

# 3. 填凭据:见本仓库 secrets/README.md 里 %WEREAD_DIR% 开头的几行

# 4. 注册计划任务 + 体检
powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
node src/index.js auth
```

## 这台机器上的运行约定

- 计划任务 `WeReadSignIn`:登录后 10 分钟触发(其后 1 小时内每 10 分钟重试)+ 每天 08:30 起每 60 分钟一次、持续 14 小时。与微软积分错峰(它 08:00 / 登录后 3 分钟),见 `tasks/scheduling-convention.md`。
- 每次触发分两段过守卫。**本地段**(不联网、约 0.7 秒):已达标 / 尝试次数 / 同伴在跑 / 安静时段 / 距关机不足 30 分钟 / 内存不足;**联网段**:凭据体检(失效自动续期)与官方统计读取。本地段不满足时不访问网络。
- 通知走企业微信:真跑一次发「开始 + 结束」两条;跳过类同一天同一种原因最多一条;凭据失效每次提醒。
- 停用/卸载:`Disable-ScheduledTask -TaskName WeReadSignIn` / `Unregister-ScheduledTask -TaskName WeReadSignIn`;临时暂停在程序目录放 `data/paused`。

## 日志与状态(都在 `%WEREAD_DIR%` 下)

| 路径 | 内容 |
| --- | --- |
| `logs\last-run.log` | 最近一次运行输出(上一次在 `previous-run.log`) |
| `logs\weread.log` | 底座日志(请求进度、成功/失败) |
| `data\state.json` | 当日状态(今日分钟、目标、尝试次数、是否达标) |
| `data\history.json` | 最近 200 次运行记录 |
| `data\paused` | 存在即暂停 |

## 登录会过期吗

会,但程序自己续。`wr_skey` 约 1.5 小时,`wr_rt` / `wr_vid` / `wr_pf` 360 天,都是滚动刷新;每次运行前做一次凭据体检,失效就先续期,仍失效就推企业微信「需要重新登录」并跳过。

只有长期不开机(超过 360 天)或你在别处主动退出登录之后,才需要手动重抓一次 `read` 请求的 cURL 覆盖 `secrets\read-request.curl`(具体命令见权威仓库 README)。
