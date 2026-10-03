# 自动脚本全貌

这台机器上「每天自己跑一次」的三个自动化程序:是什么、代码在哪、跑在哪、怎么被调度、
怎么通知、凭据放哪、哪些搬不走。**本文是索引**,每个细节都指向真源文件,不复制它们的正文。

- 所在仓库:`Zzz210s/home-automation-configs`(公开),本文即 `docs/automation-overview.md`
- 内容核对时间:2026-10-03(计划任务状态、上游 PR/issue 状态均为当时实查)

## 0. 真源在哪(改东西先看这张表)

| 内容 | 真源 |
| --- | --- |
| 云主机错峰槽位、两段守卫、一天一次幂等 | `docs/cloud-scheduling-convention.md` |
| 本机错峰槽位、锁与启动流程 | `tasks/scheduling-convention.md` |
| 通知 4 类型、频率限制、文案硬规则 | `docs/notification-convention.md` |
| 为什么上云、云端分工与代价 | `docs/cloud-vm.md` |
| 微软积分运行器与通知层 | 开发目录 `%REWARDS_DIR%\`(本地 git 仓库);同步副本在 `microsoft-rewards/` |
| 微信读书签到程序 | 权威仓库 `Zzz210s/weread-signin`(已归档);本仓库 `weread-signin/` 是快照 |
| 智慧树刷课配置 | `autovisor/configs.ini` |
| 本机计划任务清单与停用命令 | `tasks/inventory.md` |
| 每个凭据「去哪拿」 | `secrets/README.md` |

## 1. 三个程序各一行

| 程序 | 干什么 | 代码来源 / 仓库 | 本地路径 | 跑在哪台机器 | 什么时候跑 | 运行时 | 凭据从哪来 | 通知怎么发 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **微软积分** | 每天跑 Microsoft Rewards:搜索、活动、读文章,算完分推送 | 上游 `TheNetsky/Microsoft-Rewards-Script` v4.3.2(GPL-3.0)+ 本机在程序目录里的本地提交(补丁、`scripts/windows/` 运行器、`wechat-bridge/` 通知层);**没有远端**,`git remote` 只有 upstream | `%REWARDS_DIR%` | 本机 Windows | 登录后 3 分钟(其后 1 小时内每 10 分钟)+ 每天 08:00 起每 2 小时一次,14 小时窗口,一天最多 3 次尝试 | Node.js >= 24(实测 v24.14.0)+ Playwright 驱动浏览器 + SQLite 存登录态 | `%REWARDS_DIR%\.env`:5 个账号的邮箱与密码(当前 0 个账号配 TOTP) | 企业微信群机器人;发送层 `wechat-bridge/`,`webhook` 在 `wechat-bridge\data\wecom-webhook.txt` |
| **微信读书签到** | 每天完成阅读挑战打卡(读满当日目标,按剩余进度自动算,单日上限 120 分钟;例 2026-10-03 目标是 60 分钟),再用官方只读 API 回读校验时长真被计入 | `Zzz210s/weread-signin`(公开,MIT);底座 `funnyzak/weread-bot` 固定在 `vendor/`,commit 记在 `VENDOR_COMMIT.txt` | `%WEREAD_DIR%` | 本机 Windows | 登录后 10 分钟(1 小时内每 10 分钟重试)+ 每天 08:30 起每 60 分钟一次,14 小时窗口 | Node.js >= 20.11(实测 v24.14.0)+ Python 3(实测 3.14.6,vendor 依赖 `requests` / `httpx` / `PyYAML` / `urllib3` / `croniter` / `apprise`) | `%WEREAD_DIR%\secrets\`:`read-request.curl`(网页 cookie)、`weread-api-key.txt`(官方只读 Key)、`app-credentials.json` + `app-token.json`(App 渠道) | 企业微信群机器人;`secrets\wecom-webhook.txt`,发送层 `src/notify.js` |
| **智慧树刷课** | Autovisor 自动播放智慧树/知到的共享课视频 | 上游 `CXRunfree/Autovisor` v3.17.3(MIT),**代码未改**,只改配置 | `%AUTOVISOR_DIR%\app`(原始 zip 备份在 `%AUTOVISOR_DIR%`) | **只在本机 Windows**(需要本机 Chrome 与图形会话) | **手动**:跑 `Autovisor.exe`;**没有计划任务** | 打包好的 exe(PyInstaller;内嵌 Python 3.10 + Playwright)+ 本机标准路径的 Chrome | 运行时手动登录一次,登录态落 `app\data\cookies.json`;`configs.ini` 的账号密码**留空** | 程序自带界面与日志(`app\logs\LogN.txt`),**不接企业微信** |

第三个任务不属于「程序」但同属这套自动化:计划任务 `AutoShutdown0200` 每天 02:00 无条件真关机
(`shutdown /s /f /t 60`,60 秒内 `shutdown /a` 可撤销),脚本 `microsoft-rewards/scripts-windows/auto-shutdown.bat`。

## 2. 仓库清单

| 仓库 | 可见性 | 作用 | 现状备注 |
| --- | --- | --- | --- |
| `Zzz210s/home-automation-configs` | PUBLIC(用户跑 `public-reset-wizard.sh` 删库重建后) | 唯一的配置与文档仓库:三个程序的配置、运行器脚本、通知层、换机恢复说明、约定文档、向导脚本,以及 `weread-signin/` 的代码快照 | 同时是恢复包;删库重建用于清掉旧对象 |
| `Zzz210s/weread-signin` | PUBLIC,已归档(只读) | 微信读书签到的程序本体(源码、模板、Windows 调度脚本) | 权威开发来源,历史留档;`home-automation-configs/weread-signin/` 是它的快照,用 `scripts/sync-weread-signin.sh` 同步 |
| `Zzz210s/weread-bot` | PUBLIC(fork) | `funnyzak/weread-bot` 的 fork,只是贡献协议的上游通道 | 带开放 PR #53 与 issue #52,见第 8 节 |

## 3. 调度约定

### 3.1 错峰槽位(每个程序一个,避免抢内存与出口 IP)

| 程序 | 本机现状(Windows 计划任务) | 云端规划槽位 | 幂等依据 |
| --- | --- | --- | --- |
| 微软积分 | 登录后 3 分钟 + 08:00 起每 2 小时(14 小时窗口) | 08:00,`microsoft-rewards.timer` 每天一次 | `logs\last-run.state` 记 `日期 9` = 当天已完成;尝试上限 3 |
| 微信读书签到 | 登录后 10 分钟 + 08:30 起每 60 分钟(14 小时窗口) | 08:30,`weread-signin.timer` 每天一次 | `data\state.json` 的 `done`、尝试次数 |
| 智慧树刷课 | 手动 | 不上云 | 无(人工判断) |

槽位规则:每个程序占 30 分钟,新程序顺延(08:00 → 08:30 → 09:00);云端用主机本地时区
(建议 `Asia/Shanghai`),`Persistent=false` —— 云端 7×24 在线,不需要补跑。

### 3.2 触发骨架与两段守卫

触发只负责「给一次机会」,程序自己判断该不该真跑。一次触发分两段:

1. **本地段(不联网,应 < 1 秒)**:已达标 / 尝试次数用尽 / 同伴在跑 / 安静时段
   (默认 20:00-23:00)/ 距 02:00 关机不足 30 分钟 / 可用内存不足。
   微软积分还多一条:运行前自适应写回 `clusters`(可用内存 ≥2500MB → 2 并行,
   1200-2499MB → 1,<1200MB 直接跳过本次);微信读书低于 600MB 跳过。
2. **联网段**:凭据体检与滚动续期 → 读官方数据 → 真跑。

本地段不满足时**绝不访问网络**。微软积分的逻辑日以 04:00 为界(凌晨那次算前一天),
保证开机后那次一定是新一天的第一跑。

### 3.3 同伴互查与单实例锁

- 运行前先看同伴有没有在跑,任一在跑就跳过本次(理由:小规格机器别同时抢内存与出口 IP)。
- 微软积分:单实例锁 `logs\run.lock`。判定以「是否有 node 在跑 `dist\index.js`」为权威,
  残留锁立即回收(所以崩溃留下的锁不会挡住重试)。
- 微信读书:进程锁 + `--force` 手工绕过安静时段;临时暂停在程序目录放 `data/paused`。
- 云端改用 `flock`(进程一死锁自动释放,不存在残锁问题)。

### 3.4 看门狗与超时

| 程序 | 超时 | 行为 |
| --- | --- | --- |
| 微软积分 | `run-watchdog.bat` 默认 150 分钟 | 超时强杀,发通知说明,当天剩余触发会重试未完成的账号 |
| 微信读书签到 | `RUN_TIMEOUT_MINUTES=100` | 同理,单次运行上限 100 分钟 |

配套余量:微软积分最近一次实测 44.3 分钟(5 个账号,2026-10-03),150 分钟的超时线留得很充分。

## 4. 通知约定

两个 Windows 程序共用一个企业微信群机器人,消息类型统一为 **4 种**(2026-10-03 定,
原来的 `day` 当日汇总类型已删除,当日口径并入 `result` 消息的汇总行)。

| 类型 | 什么时候发 | 频率上限 | 微软积分实现 | 微信读书实现 |
| --- | --- | --- | --- | --- |
| `start` 开始运行 | 真要跑了,run 之前 | 每次运行一条,当天最多 3 次尝试 | `wechat-bridge/notify-start.js` + `lib/start.js` | `src/notify-policy.js` `buildStartMessage` |
| `result` 运行结果 | 每次运行结束:成功 / 有失败 / 中断无数据 | 每次运行一条(日志里没结论时不发) | `wechat-bridge/notify-run.js` + `lib/report.js` | `src/notify.js` `buildReport` |
| `skip` 正常跳过 | 触发被规则拦下,这次不跑 | **同一天同一种原因最多一条** | `wechat-bridge/notify-skip.js` `memory` / `handled` | `shouldNotifyOnce` |
| `action` 需要你处理 | 不处理就永远不会自己好 | **每次都发,不受限制** | `notify-skip.js` `nocreds` | `credential-invalid`、`stats-unavailable` |

文案硬规则(所有消息,违反就等于发错):

- **不用圆括号** —— 补充说明一律用 ` · ` 分隔。企业微信是纯文本,窄屏折行后括号内容会和正文糊在一起;
  批处理传参时括号还会被 `cmd` 当块分隔符(踩过)。
- **不用 emoji**;分隔符统一 ` · `(前后各一个空格),不要混用 `|`、`;`、`,`。
- 标题行四段:`<程序名> · <账号或账号数> · <日期> · <动作>`;`start` 只有这一行,细节进运行日志。
- `skip` 与 `action` 正文结构不同:`skip` 是「原因 / 后续 / 你需要做什么:不需要」,
  `action` 第一句必须是「请你:」,再说原因与不处理的后果。
- 未取到的字段**不编**:读不到就少一行,不写 0、不写"未知"以外的占位。
- 解释行用两个空格缩进,跟在被解释的那一条下面,不要堆到末尾一大段。
- 单条消息 UTF-8 不超过 2048 字节(企业微信文本上限),超了发送层会截断。

## 5. 凭据清单

真实值**只在各程序自己的目录里**,仓库里只有「去哪拿」的说明。`home-automation-configs/.gitignore`
已排除 `.env`、`secrets/*`(保留 `secrets/README.md`)、`*webhook*.txt`、`data/`、`sessions/`、`logs/`。

| 凭据 | 存在哪个文件 | 有效期 | 失效后怎么恢复 |
| --- | --- | --- | --- |
| 微软账号邮箱 + 密码(5 个) | `%REWARDS_DIR%\.env` 的 `ACCOUNT_N_EMAIL` / `ACCOUNT_N_PASSWORD` | 无固定期限;改密码即失效 | 更新 `.env`;密码错会在结果消息里报登录失败。注意别把 6 位 PIN 当密码 |
| 微软 TOTP 密钥(可选) | 同上,`ACCOUNT_N_TOTP_SECRET` | 随账号 2FA 重置 | 当前 0 个账号配置;要省掉手动批准 2FA 就补一个 |
| 微软登录态与指纹 | `%REWARDS_DIR%\sessions\sessions.db`(SQLite) | 会话级 | 失效会退回密码登录;删掉即强制重登 |
| 企业微信 webhook(微软侧) | `%REWARDS_DIR%\wechat-bridge\data\wecom-webhook.txt` | 无固定期限;把机器人移出群即失效 | 企业微信群 → 添加群机器人 → 复制 webhook 写回该文件 |
| 微信读书网页 cookie | `%WEREAD_DIR%\secrets\read-request.curl` | `wr_skey` 约 1.5 小时(每次运行前自动续期);`wr_rt` / `wr_vid` / `wr_pf` 360 天,滚动刷新 | 程序自己续:先 `node src/index.js auth`;仍失效就推「需要重新登录」——手动重抓:浏览器对 `https://weread.qq.com/web/book/read` 发起请求 → Copy as cURL (bash) → 覆盖该文件。只有超 360 天没开机或在别处主动退出登录才需要这一步 |
| 微信读书官方只读 API Key | `%WEREAD_DIR%\secrets\weread-api-key.txt`(`wrk-...`) | 无固定文档期限,可在控制台随时作废 | 去 `https://weread.qq.com/r/weread-skills` 领新的写回文件,再跑 `node src/stats.js weekly` 只读验证(2026-10-03 轮换过一次) |
| 微信读书 App 渠道凭据 | `%WEREAD_DIR%\secrets\app-credentials.json`、`app-token.json`、`app-login-qr.png` | token 会过期 | `node src/app-login.js qr` 出二维码 → 手机扫码 → `node src/app-login.js wait` 落盘;福利书币依赖它 |
| 企业微信 webhook(微信读书侧) | `%WEREAD_DIR%\secrets\wecom-webhook.txt` | 同上 | 同上;该文件不存在时不推送 |
| 智慧树登录态 | `%AUTOVISOR_DIR%\app\data\cookies.json` | 站点会话过期即失效 | 重跑 `Autovisor.exe` 手动登录一次(换浏览器不用重登,登录态不在浏览器里) |
| 智慧树账号密码 | **不存任何文件**,`configs.ini` 留空 | — | 每次手动输入 |

## 6. 哪些环节必须在本机

| 必须本机 | 为什么 |
| --- | --- |
| 智慧树刷课 | Autovisor 用 Playwright 驱动**本机 Chrome** 播放视频,依赖图形会话;云主机没有可用桌面,也不该在无人看的服务器上放课件 |
| Windows 计划任务 | 现状是三个任务(`MicrosoftRewardsScript` / `WeReadSignIn` / `AutoShutdown0200`,见 `home-automation-configs/tasks/inventory.md`);搬走要换成 systemd timer |
| 看门狗、单实例锁、内存闸门 | 现在是 `.bat` / `.js` 实现,读的是本机内存水位与进程表;云端要改成 `flock` + systemd 超时 |
| 02:00 无条件关机 | 本机专属任务,云端不需要 |

理论上可以搬走:**微软积分**与**微信读书签到** —— 都是纯 HTTP/脚本,不需要图形界面;
瓶颈只是缺一台 7×24 的机器,所以才有 Oracle 方案(见下节)。

## 7. 未完成 / 受阻的事

1. **Oracle Cloud 免费 ARM 迁移:卡在注册风控,还没开通。**
   用 ZA Bank(众安银行,香港)的 Visa 扣账卡注册,报错是**地址字段格式校验**
   (`Enter a valid value for Address Line 1`),与卡种无关;专项调研(2026-10-03,
   `docs/oracle-za-bank-notes.md`,该文件不入库)的结论是:
   ZA Bank × Oracle 目前**零成功案例**,但卡种属性不是障碍(香港扣账卡有成功先例),
   真正卡住的是「国家 / 地址 / 电话 / IP 四者自洽」这一层。
   进展可查:`~/.config/automation-suite/` 目录仍是空的(`vm.env` 未生成),说明
   `oracle-setup-wizard.sh` 没走完。
2. **GitHub Actions 云端方案:已评估否定。**
   私有仓免费额度不够每天跑(这两个程序单次要几分钟到几十分钟,不是几秒);
   公开仓会暴露「哪个账号在刷什么」—— workflow 与提交历史谁都能看,而
   cookie、邮箱等关联信息还可能进日志;而且 Actions 的 cron 触发会排队延迟、
   高峰期直接丢触发,不满足「一天必须跑一次」的语义。
3. **智慧树不能上云**:需要图形会话与本机 Chrome(见第 6 节),上游也不支持无头播放课件。

## 8. 上游贡献状态(`funnyzak/weread-bot`,2026-10-03 实查)

| 条目 | 状态 | 详情 |
| --- | --- | --- |
| PR [#53](https://github.com/funnyzak/weread-bot/pull/53) | **OPEN,未合并** | 标题「fix: 凭据续期后把新 cookie 原子写回来源文件」;2026-10-02 创建、同日最后更新;`reviewDecision` 为空、**0 条评论** —— 维护者还没看过 |
| issue [#52](https://github.com/funnyzak/weread-bot/issues/52) | **open** | 标题「已经成功:自动领取奖励」;2026-09-25 创建、2026-10-02 更新;**1 条评论,是我们自己发的** —— 里面有 `/weekly/exchange`、`/reader/welfareCoin`、`/pay/balance`、`/challenge/detail`、`/readdata/detail` 的实测协议,并问了「是否接受 AI 辅助的 PR」。维护者未回复 |

也就是说:两条都还挂着,没有第三方回应,没有合并,也没有被关闭。

## 9. 维护须知

- 改「会怎么跑、什么时候跑」→ 本机改 `tasks/scheduling-convention.md`,云主机改
  `docs/cloud-scheduling-convention.md`,再改程序里的守卫。
- 改「消息长什么样」→ 改 `docs/notification-convention.md`,两边实现与测试一起改
  (文案断言已经锁住「不带圆括号」与标题行形状)。
- 改微软积分的运行器或通知层 → **在 `%REWARDS_DIR%\` 里改并提交**
  (那才是开发目录),再把 `wechat-bridge/` 与 `scripts/windows/` 覆盖回本仓库。两处都改必分叉。
- 改微信读书签到代码 → **在权威仓库的本地克隆里改并提交**,再跑 `scripts/sync-weread-signin.sh`
  刷新本仓库的 `weread-signin/` 快照。直接改快照必被下次同步覆盖。
- 三处凭据相关文件(`secrets/README.md`、各子 README、`tasks/inventory.md`)在换机恢复时
  是唯一线索,移动路径或换文件名时一起更新。
