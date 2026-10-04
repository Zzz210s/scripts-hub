# 凭据清单(本文件不存任何值)

真实值只在各程序自己的目录里;本仓库只有模板和这份说明。`.gitignore` 已排除 `.env`、
`secrets/*`、`*webhook*.txt`、`data/`、`sessions/`、`logs/`。换机恢复时按本表逐个补齐即可。

路径占位符 `%REWARDS_DIR%` / `%AUTOVISOR_DIR%` / `%WEREAD_DIR%` / `%EPIC_DIR%` 见根 README 的「路径约定」。

## 微软积分(`%REWARDS_DIR%`)

| 凭据 | 文件 | 去哪拿 | 有效期与恢复 |
| --- | --- | --- | --- |
| 账号邮箱与密码(可多个) | `.env` 的 `ACCOUNT_N_EMAIL` / `ACCOUNT_N_PASSWORD` | 自己的微软账号;从本仓库 `proj-microsoft-rewards/env.example` 复制成 `.env` 后填 | 无固定期限,改密码即失效;更新 `.env`,无需重新构建。注意别把 6 位 PIN 当密码 |
| TOTP 密钥(可选) | `.env` 的 `ACCOUNT_N_TOTP_SECRET` | 账号的 2FA 设置 | 随账号 2FA 重置;不配就得手动批准登录挑战(当前未配) |
| 登录态与浏览器指纹 | `sessions\sessions.db`(SQLite) | 程序自动生成 | 会话级;失效会退回密码登录,删掉即强制重登 |
| 企业微信群机器人 webhook | `wechat-bridge\data\wecom-webhook.txt` | 企业微信 App → 目标群 → 右上角 `...` → 群机器人 → 添加机器人 → 复制地址 | 无固定期限;把机器人移出群即失效,重新复制一份写回 |

## 微信读书签到(`%WEREAD_DIR%`)

| 凭据 | 文件 | 去哪拿 | 有效期与恢复 |
| --- | --- | --- | --- |
| 网页 cookie | `secrets\read-request.curl` | 浏览器对 `https://weread.qq.com/web/book/read` 发起请求 → Copy as cURL (bash) → 覆盖该文件 | `wr_skey` 约 1.5 小时,`wr_rt` / `wr_vid` / `wr_pf` 360 天,都滚动刷新。程序每次运行前自动续期;先 `node src/index.js auth`;仍失效会推「需要重新登录」。只有超 360 天没开机或别处主动退出登录才需手动重抓 |
| 官方只读 API Key | `secrets\weread-api-key.txt`(`wrk-...`) | <https://weread.qq.com/r/weread-skills> | 无固定期限,可随时作废;换新的后跑 `node src/stats.js weekly` 只读验证 |
| App 渠道凭据 | `secrets\app-credentials.json`、`app-token.json`、`app-login-qr.png` | `node src/app-login.js qr` 出二维码 → 手机扫码 → `node src/app-login.js wait` | token 会过期;福利书币依赖它,没有则跳过相关步骤 |
| 企业微信群机器人 webhook | `secrets\wecom-webhook.txt` | 同上,企业微信群机器人 | 文件不存在时不推送 |
| 挑战窗口与守卫参数 | `.env` | 从本仓库 `proj-weread-signin/.env.example` 复制 | `CHALLENGE_START` / `CHALLENGE_ENDS_ON` 等;不配时按「今天起 30 天」兜底 |
| 底座配置 | `config.yaml` | 从本仓库 `proj-weread-signin/config.yaml.example` 复制 | 书籍、目标区间、通知 webhook;`target_duration` 由 plan/run 自动改写 |

## 智慧树刷课(`%AUTOVISOR_DIR%`)

| 凭据 | 文件 | 去哪拿 | 有效期与恢复 |
| --- | --- | --- | --- |
| 登录态 | `app\data\cookies.json` | 运行 `Autovisor.exe` 时手动登录一次后自动生成 | 站点会话过期即失效;重跑程序手动登录(登录态不在浏览器里,换浏览器不用重登) |
| 账号密码 | 不存文件,`configs.ini` 的 `username` / `password` 留空 | — | 每次手动输入 |

## Epic 限免领取(`proj-epic-free-games/`)

| 凭据 | 文件 | 去哪拿 | 有效期与恢复 |
| --- | --- | --- | --- |
| 设备授权令牌 | `secrets\epic-tokens.json` | 跑 `node src/cli.js login`,按提示在浏览器确认一次;程序自己写入 | access token 约 2 小时,每次运行自动刷新延长;refresh token 响应里带 `refresh_expires_at`,实测约 23 天且随刷新滚动。只有被 Epic 吐销时才要重跑 `login`,用 `node src/cli.js auth` 看到期时间 |
| 浏览器登录态 | `data\browser\`(目录,不是单个文件) | 登录流程生成;程序每次运行把 `EPIC_BEARER_TOKEN` 注入这里 | profile 自身会话失效时自动靠上面的 token 重新注入;注入失败退化用既有会话。兜底入口 `node src/cli.js login --browser` |
| 企业微信群机器人 webhook | `secrets\wecom-webhook.txt` | 同上,企业微信群机器人 | 文件不存在时不推送 |

**没有密码类凭据**:程序刻意不向引擎传 `EG_EMAIL` / `EG_PASSWORD`,所以不存在「密码泄漏」这条路径。
上游支持存密码,本项目不用。

## 与本仓库无关的私有文件

`~/.config/automation-suite/local-paths.env` 是**路径配置**,不是凭据:它告诉 `scripts/*.sh`
本机的 `%WEREAD_DIR%`、本仓库路径与备份镜像在哪。该文件名与目录名保持历史值不改(改了本机脚本就失效),
且永不入库。
