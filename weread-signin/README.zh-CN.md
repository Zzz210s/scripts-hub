> **自动生成的快照,不要直接改这里。** 本目录由 `scripts/sync-weread-signin.sh` 从本机开发克隆
> `%WEREAD_DIR%` 发布而来;取快照时的提交记录在 `SNAPSHOT.txt`。要改代码,在那个克隆里改并提交,
> 再跑该脚本、在这里提交结果。这个程序没有独立仓库 —— 本目录就是它对外发布的那一份。
> 本目录手写的 `LOCAL-DEPLOYMENT.md` 不参与同步。本目录文件为 MIT 许可(见 `LICENSE`),
> 本仓库其余部分为 GPL-3.0。

# 微信读书每日签到

自动完成微信读书阅读挑战的每日打卡,并**用腾讯官方只读 API 校验时长是否真的被计入**。

[English](README.md)

底座复用 [funnyzak/weread-bot](https://github.com/funnyzak/weread-bot)(MIT):它负责"按抓包请求上报阅读时长"。本项目只补它没有的三块:

1. **读回校验** —— 跑完调官方 API 看今日分钟数有没有真的增长,而不是只信"请求成功"
2. **进度规划** —— 按"剩余天数 / 剩余时长"算出今天该读多久,并拆成不超过 30 分钟的段落
3. **无人值守调度** —— Windows 计划任务 + 单实例锁 + 看门狗 + 配额守卫 + 关机避让

## 背景:为什么需要读回校验

网页版阅读上报的接口只回一个空 JSON,**无法判断这次阅读有没有被算进挑战**。官方的只读 API(`/readdata/detail`)能给出按天分桶的阅读秒数:

```
跑之前  官方今日 = 30 秒
跑之后  官方今日 = 352 秒   # 本次会话 6 分 5 秒,确实被计入
```

单位是**秒**不是分钟;官方 `readDays` 的口径是"单日满 1 分钟",与挑战要求的"单日满 5 分钟"不同,所以判定当天是否达标要看今日桶秒数。

## 工作原理

```
src/
  cli.js / index.js       命令行:plan / run / status / verify / auth / report / pause / resume
  run.js                  一次完整运行:读回统计 -> 算目标 -> 过守卫 -> 写回目标 -> 调底座 -> 再读回
  guards.js / clock.js    纯本地守卫:安静时段、关机避让、尝试次数、当日窗口
  plan.js                 每日目标与分段
  peer.js                 错峰:让路给正在跑的同伴程序(如占用锁的另一个自动化)
  auth.js                 凭据体检与滚动续期
  stats.js                官方只读统计(按天秒数)
  notify.js               企业微信推送:脱敏、按 UTF-8 字节截断、超时重试
  notify-policy.js        通知策略:把"为什么不跑"翻译成人话,并按天限制同类提醒
  welfare*.js / rewards*.js / balance.js / member-card.js / weekly.js
                          福利书币、每周奖励档位、钱包余额、体验卡
  app-*.js                可选的 App 通道凭据、上报与扫码登录
  state.js / atomic.js    运行状态与历史(JSON + 原子写)
scripts/windows/          计划任务入口、单实例锁、看门狗、注册脚本
test/                     单元测试(node --test,无网络)
tools/                    一次性只读探针(DEX 解析、统计/时间诊断)
```

每次运行分两段。第一段纯本地 —— 已暂停、今天已达标、尝试次数用尽、同伴程序在跑、安静时段、距关机不足 30 分钟 —— 命中任何一条都**不访问网络**直接返回。第二段先做凭据体检(失效则续期),再读官方统计,然后算今日目标与分段。

## 依赖

- Node.js >= 20.11(用到 `import.meta.dirname` 与内置测试运行器)
- Python 3.9+ 及底座依赖(`requests`、`httpx`、`PyYAML`、`urllib3`、`croniter`、`apprise`)—— 上报层需要用
- 一个微信读书账号(网页 cookie)与官方只读 API Key
- Node 侧零第三方依赖,只用标准库

## 安装

```bash
# 1. 底座(固定在 VENDOR_COMMIT.txt 记录的 commit)
mkdir -p vendor && cd vendor
git clone https://github.com/funnyzak/weread-bot.git
cd weread-bot && git checkout 0cc9b5c309d1ede76b60f7fd453f6eb403b6307b
pip install -r requirements.txt
cd ../..

# 2. 凭据目录
mkdir -p secrets
# secrets/read-request.curl     浏览器里对 https://weread.qq.com/web/book/read 请求"Copy as cURL (bash)"的完整内容
# secrets/weread-api-key.txt    官方 API Key:https://weread.qq.com/r/weread-skills(形如 wrk-xxxx)
# secrets/wecom-webhook.txt     企业微信群机器人 webhook(可选,不配就不推送)
# secrets/app-credentials.json  App 通道凭据(福利书币要用):先 node src/app-login.js qr 生成二维码,
#                               再 node src/app-login.js wait 等扫码;缺它福利步骤直接跳过(不报错)

# 3. 配置
cp .env.example .env                 # 填挑战起止日期等
cp config.yaml.example config.yaml   # target_duration 由本项目的 plan/run 自动改写
```

`config.yaml` 与 `secrets/` 已被 gitignore,不会提交。

## 用法

```bash
node src/index.js plan            # 今天该读多久(只算不跑)
node src/index.js run             # 跑一次(遵守安静时段与关机避让)
node src/index.js run --force     # 手动跑,不受安静时段限制
node src/index.js status          # 当日状态 + 最近记录 + 官方统计
node src/index.js verify          # 只看官方读回
node src/index.js report          # 打印并推送当前汇总
node src/index.js auth            # 凭据体检(失效时自动续期)
node src/index.js auth --force    # 强制续期,把服务端有效期窗口往后推
node src/index.js pause / resume  # 暂停 / 恢复自动运行
npm test                          # 单元测试,不需要网络
```

## 配置

`.env` 存挑战窗口与阅读参数;`config.yaml` 是底座配置,会被 `plan`/`run` 随进度自动改写。常用项见 [.env.example](.env.example),节选:

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `CHALLENGE_START` / `CHALLENGE_ENDS_ON` | 空 | 挑战起止日期;不填按"今天起 30 天"兜底并在日报里提醒 |
| `REQUIRED_MINUTES` | 1800 | 挑战要求的总时长(30 小时) |
| `REQUIRED_VALID_DAYS` | 29 | 需要的有效天数 |
| `MIN_VALID_MINUTES` | 5 | 有效日门槛(当天阅读 > 5 分钟) |
| `SLACK_MINUTES` | 6 | 给官方统计漏计留的余量 |
| `DAILY_CAP_MINUTES` | 120 | 单日上限,避免"单次自动阅读过长不计入" |
| `SECTION_MINUTES` | 30 | 单段上限 |
| `QUIET_START` / `QUIET_END` | 20:00 / 23:00 | 不打扰真实阅读的时段 |
| `SHUTDOWN_TIME` / `SHUTDOWN_GUARD_MINUTES` | 02:00 / 30 | 关机时刻与避让余量 |
| `RUN_TIMEOUT_MINUTES` | 100 | 一次会话的最长时长(超过被看门狗中止) |
| `MAX_ATTEMPTS_PER_DAY` | 3 | 每天最多尝试几次 |

### 日报里的两个数字怎么算

- **今日目标** = `ceil(剩余分钟 ÷ 剩余天数) + 6 分钟余量`,夹在 5-120 分钟之间;总量已达标时只读 5 分钟保住连续打卡。
- 再按当日窗口校正(剩余可跑次数 × `RUN_TIMEOUT_MINUTES`、到安静时段开始、到关机避让线三者取最小);窗口不够就把缺口分给后面的日子,但**有效日下限 5 分钟不会被压破**。
- 写进底座的是**本次会话**(目标 − 今日已读,不超 `RUN_TIMEOUT_MINUTES`),不是整天的目标。
- **还可以漏几天** = 取时间容错与有效天数容错的较小值;挑战要求 29/30 天有效,所以第一天即使时间上很宽裕,也只能漏 1 天。

### 登录能撑多久(滚动续期)

实测(2026-10-01)续期接口 `POST /web/login/renewal` 返回的凭证有效期:

| Cookie | 有效期 | 说明 |
| --- | --- | --- |
| `wr_skey` | 1.5 小时 | 短期凭证,每次续期刷新窗口 |
| `wr_rt` / `wr_vid` / `wr_pf` | 360 天 | 长期凭证,同样滚动刷新 |

底座每次会话开始都会调一次续期(内存里生效);本项目在每次运行前做**凭据体检**(`GET /web/user?userVid=…`),失效就先续期、仍失效就推企业微信「需要重新登录」并跳过。续期若返回了新 cookie 值,会**原子回写**进 `secrets/read-request.curl`。

### 通知策略

- **一次运行最多两条**:开始一条、结束一条。
- **跳过类提醒同一天同一种原因只发一条**,并且必须回答三件事:发生了什么 / 为什么 / 接下来会怎样。
- **需要人工处理的情况不受频率限制**:登录凭据失效、读不到官方统计,每次都会提醒。
- `--dry` 只预览文案,不发送、也不消耗当天的提醒额度。

## 无人值守(Windows)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
```

注册计划任务 `WeReadSignIn`:登录后 3 分钟触发(1 小时内每 10 分钟重试一次)+ 每天 08:00 起每 60 分钟一次、持续 14 小时。每次触发都要过守卫,细节见 `scripts/windows/README-autostart.md`。

## 测试

```bash
npm test          # node --test test/*.test.js
```

共 215 个用例,不访问网络。

## 已知限制

- 无人值守的调度脚本仅支持 Windows(计划任务、PowerShell、VBS)。
- 依赖未公开的接口,底座与官方只读 API 都可能随时变动。
- `report` 与福利步骤需要 App 通道凭据;没有时这些步骤跳过而不是报错。
- 自动化阅读可能违反微信读书的用户协议,存在账号风险。

## 免责声明

本项目供个人使用与学习。自动化阅读可能违反微信读书的用户协议,存在账号风险。默认配置刻意分多段、只求刚过门槛、并留出安静时段。请自行判断是否使用。

## 许可

MIT,详见 [LICENSE](LICENSE)。底座的 [funnyzak/weread-bot](https://github.com/funnyzak/weread-bot) 同样采用 MIT 许可。
