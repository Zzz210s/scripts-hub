# 需要填写的真实值(本文件不存值)

`%REWARDS_DIR%` / `%AUTOVISOR_DIR%` / `%WEREAD_DIR%` 是各程序本体的安装目录,见根目录 README 的「路径约定」。

| 文件/位置 | 需要什么 | 去哪拿 |
| --- | --- | --- |
| `%REWARDS_DIR%\.env` | 每个账号的邮箱与密码(`ACCOUNT_N_EMAIL` / `ACCOUNT_N_PASSWORD`) | 自己的微软账号;密码只写在此文件,不入库 |
| `%REWARDS_DIR%\wechat-bridge\data\wecom-webhook.txt` | 企业微信群机器人 webhook 地址 | 企业微信群 → 添加群机器人 → 复制 webhook |
| `%AUTOVISOR_DIR%\app\data\cookies.json` | 智慧树登录态(首次手动登录后自动生成) | 运行 Autovisor 时手动登录一次 |
| `%WEREAD_DIR%\.env` | 挑战起止日期与守卫参数 | 从 `Zzz210s/weread-signin` 仓库复制 `.env.example` |
| `%WEREAD_DIR%\config.yaml` | 底座配置(书籍、目标区间、通知 webhook) | 从 `Zzz210s/weread-signin` 仓库复制 `config.yaml.example` |
| `%WEREAD_DIR%\secrets\read-request.curl` | 网页版 `read` 请求的 cURL(含 cookie) | 浏览器对 `https://weread.qq.com/web/book/read` 请求 Copy as cURL (bash) |
| `%WEREAD_DIR%\secrets\weread-api-key.txt` | 形如 `wrk-xxxx` 的官方 API Key | https://weread.qq.com/r/weread-skills |
| `%WEREAD_DIR%\secrets\wecom-webhook.txt` | 企业微信群机器人 webhook | 企业微信群 → 添加群机器人 |

## 原则

- 真实值与 cookie **只保存在各程序本体的目录里**,本仓库只放模板与「去哪拿」的说明。
- 即使仓库是私有的,也不把 `.env`、cookie、webhook 提交进来(`.gitignore` 已排除)。
