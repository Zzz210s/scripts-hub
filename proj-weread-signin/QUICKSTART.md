# QUICKSTART — weread-signin

自动完成微信读书阅读挑战的每日打卡,并用官方只读 API 校验时长是否真的被计入。
本目录由 `scripts/sync-weread-signin.sh` 从 `%WEREAD_DIR%` 发布而来。

## 前置条件

- Node.js >= 20.11(用到 `import.meta.dirname`);Node 侧零第三方依赖
- Python 3.9+ 与底座依赖(只有真跑阅读时需要)
- 一个微信读书账号的网页 cookie + 官方只读 API Key

## 三条命令

```bash
cd proj-weread-signin
cp .env.example .env && cp config.yaml.example config.yaml   # 模板(按需改挑战日期)
npm test                                                     # 218 条,离线,不需要凭据
node src/index.js status                                     # 本地干跑:不登录、不读时长
```

一条命令跑完全部自检(建模板、查凭据、可选装底座、跑测试、干跑):

```bash
bash ../scripts/setup-weread-signin.sh            # 离线自检
bash ../scripts/setup-weread-signin.sh --vendor   # 顺带克隆底座(需要网络)
```

真跑一次(会登录、会上报阅读时长):

```bash
node src/index.js run --force
```

## 需要填的凭据

放 `secrets/`(已 gitignore,不会入库):

| 文件 | 必需 | 怎么来 |
| --- | --- | --- |
| `secrets/read-request.curl` | 是 | 浏览器对 `https://weread.qq.com/web/book/read` 发起请求 → Copy as cURL (bash) → 整段覆盖该文件 |
| `secrets/weread-api-key.txt` | 是 | <https://weread.qq.com/r/weread-skills>(形如 `wrk-...`) |
| `secrets/wecom-webhook.txt` | 否 | 企业微信群机器人 webhook;不配则不推送 |
| `secrets/app-credentials.json` | 否 | `node src/app-login.js qr` 出二维码 → `node src/app-login.js wait` 扫码;缺它福利步骤跳过 |

底座(Python 上报层)不在仓库里,按固定 commit 克隆:

```bash
mkdir -p vendor && cd vendor
git clone https://github.com/funnyzak/weread-bot.git
cd weread-bot && git checkout 0cc9b5c309d1ede76b60f7fd453f6eb403b6307b
pip install -r requirements.txt
```

## 怎么验证跑通了

1. `npm test` 全绿(218 条,不访问网络)
2. `node src/index.js status` 打印本地状态与关机倒计时(缺 API Key 时官方统计那行会报缺失,属预期)
3. 填好凭据后 `node src/index.js auth` 通过,`node src/index.js verify` 能读到官方今日秒数
4. `node src/index.js plan` 能算出今天该读多久

## 常见失败

| 现象 | 处置 |
| --- | --- |
| `找不到 API Key 文件` | `secrets/weread-api-key.txt` 缺失或为空 |
| `ENOENT ... read-request.curl` | 还没抓 cookie;见上表 |
| `plan` 报缺 Key | 正常:`plan` 要读官方进度,填 Key 后再跑 |
| 登录态失效 | `node src/index.js auth --force` 强制续期;仍失败按提示重抓 cookie |
| 干跑 `status` 里官方统计报错 | 没有 Key 时的预期行为,不影响本地状态 |
| 计划任务不跑 | 只在 Windows 支持;见 `scripts/windows/README-autostart.md` |
