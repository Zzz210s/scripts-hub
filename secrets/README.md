# 需要填写的真实值(本文件不存值)

| 文件/位置 | 需要什么 | 去哪拿 |
| --- | --- | --- |
| `%REWARDS_DIR%\.env` | 每个账号的邮箱与密码(`ACCOUNT_N_EMAIL` / `ACCOUNT_N_PASSWORD`) | 自己账号;密码只写在此文件,不入库 |
| `%REWARDS_DIR%\wechat-bridge\data\wecom-webhook.txt` | 企业微信群机器人 webhook 地址 | 企业微信群 → 添加群机器人 → 复制 webhook |
| `%AUTOVISOR_DIR%\app\data\cookies.json` | 智慧树登录态(首次手动登录后自动生成) | 运行 Autovisor 时手动登录一次 |
| (待建)`%WEREAD_DIR%\.env` | 微信读书网页版 cookie(或运行时的抓包 cURL) | 网页版抓包,见项目说明 |
| (待建)`WEREAD_API_KEY` | 形如 `wrk-xxxxxxxx` 的官方 API Key,用于读回阅读统计 | https://weread.qq.com/r/weread-skills |

## 原则

- 真实值与 cookie **只保存在本机的配置文件中**,本仓库只放模板与"去哪拿"的说明。
- 即使这是私有仓库,也不把 `.env`、cookie、webhook 提交进来(`.gitignore` 已排除)。
