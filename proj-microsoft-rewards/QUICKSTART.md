# QUICKSTART — microsoft-rewards

跑 Microsoft Rewards 每日任务并把结果推到企业微信。本目录是权威工作区 `%REWARDS_DIR%` 的**同步快照**。

## 前置条件

- Node.js >= 24(上游声明;实测 v24.14.0)
- 网络与磁盘:依赖约 300MB,Playwright/Patchright 的 chromium 约 150MB
- 一个 Microsoft 账号(邮箱 + 密码,或 TOTP)
- 可选:企业微信群机器人 webhook(不配则不推送)

## 三条命令

```bash
cd proj-microsoft-rewards
npm ci && npx patchright install chromium   # 依赖 + 浏览器
cp env.example .env                          # 再填 ACCOUNT_1_EMAIL / ACCOUNT_1_PASSWORD
npm run build && node --test wechat-bridge/test/*.test.js
```

一条命令跑完全部自检(装依赖、装浏览器、建 `.env`、构建、跑测试):

```bash
bash ../scripts/setup-microsoft-rewards.sh
# 只想跑离线测试(已有 node_modules 时):bash ../scripts/setup-microsoft-rewards.sh --no-install --no-browser
```

真跑一次(会登录、会消耗当天配额):

```bash
npm start          # 等价于 node ./dist/index.js
```

## 需要填的凭据

| 文件 | 填什么 |
| --- | --- |
| `.env` | 每个账号一段 `ACCOUNT_N_EMAIL` / `ACCOUNT_N_PASSWORD`;可选 `_TOTP_SECRET`、`_GEO_LOCALE`、`_LANG_CODE`、`_PROXY_*` |
| `wechat-bridge/data/wecom-webhook.txt` | 企业微信群机器人 webhook(可选) |

模板是 `env.example`。登录态与浏览器指纹落在 `sessions/sessions.db`(自动生成,已 gitignore)。
完整清单见 [`../docs/credentials.md`](../docs/credentials.md)。

## 怎么验证跑通了

1. `npm run build` 无错,`dist/index.js` 存在
2. `node --test wechat-bridge/test/*.test.js` 21 条通过;`node --test scripts/windows/run-state.test.js` 5 条通过
3. `npm start` 能登录并跑到 `[ACCOUNT-END]`(真跑,会消耗配额)
4. `node ../scripts/check-wecom-drift.mjs` 通过(改过通知层才需要)

## 常见失败

| 现象 | 处置 |
| --- | --- |
| `npm ci` 后 `npm run build` 报找不到 tsc | 没装依赖;重跑 `npm ci` |
| 启动报缺 chromium | `npx patchright install chromium` |
| 登录提示密码错误 | `.env` 里别把 6 位 PIN 当密码;或用 TOTP |
| 提醒「需要验证」 | 手动批准一次 2FA,或配 `ACCOUNT_N_TOTP_SECRET` |
| 某账号只涨十几分 | 当天配额已被别处领完,不是脚本故障(推送里会附低分原因) |
| 运行被强杀 | 看门狗超时(默认 150 分钟);看 `logs/runner.log` 的 `[WATCHDOG]` |
