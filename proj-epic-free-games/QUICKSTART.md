# QUICKSTART — epic-free-games

自动领取 Epic 游戏商城的限时免费游戏,结果推到企业微信;被 hCaptcha 挡住时退化成推预置结账链接。
本目录就在本仓库里(不是生成快照),上游领取引擎原样收编在 `vendor/free-games-claimer/`。

## 前置条件

- Node.js >= 20.11;离线测试零第三方依赖
- 真跑需要引擎依赖:`patchright` 与它的 Chromium(`npm install` + `npx patchright install chromium`)
- 一个 Epic 账号,**人工登录一次**(不保存密码)
- 机器处于已登录的图形会话;引擎会弹出**可见**的浏览器窗口(上游刻意如此,为了少触发 hCaptcha)

## 三条命令

```bash
cd proj-epic-free-games
npm test                        # 78 条离线测试,不需要凭据、不联网
node src/cli.js status          # 本地状态与今日尝试次数
node src/cli.js probe           # 看当期与预告的免费游戏(只读清单,不登录)
```

一条命令跑完全部自检(测试、干跑、引擎依赖、凭据、登录态):

```bash
bash ../scripts/setup-epic-free-games.sh
```

真跑一次(会打开浏览器并结账):

```bash
npm install && npx patchright install chromium   # 只需一次
node src/cli.js login                            # 人工登录一次,不保存密码
node src/cli.js run                              # 真领一次
```

## 需要填的凭据

放 `secrets/`(已 gitignore,不会入库):

| 文件 | 必需 | 怎么来 |
| --- | --- | --- |
| `secrets/wecom-webhook.txt` | 否 | 企业微信 App -> 目标群 -> 右上角 `...` -> 群机器人 -> 添加机器人 -> 复制地址;不配则不推送 |
| `data/browser/`(不是文件,是目录) | 是 | 由 `node src/cli.js login` 生成;登录态在这里,里面没有密码 |

**不需要也不应该存密码。** 程序不会向引擎传 `EG_EMAIL` / `EG_PASSWORD`(上游支持,本项目刻意清空),
所以登录态失效时只会推「需要你处理」,由人重跑一次 `login`。

## 怎么验证跑通了

1. `npm test` 全绿(78 条,不访问网络)
2. `node src/cli.js status` 打印状态文件、账号、今日尝试次数(首次运行显示 0/2)
3. `node src/cli.js probe` 能看到当期免费游戏与预告项,并打印本周期起止时间
4. `node src/cli.js run --dry-run` 只打印「会发什么」,不联网、不起浏览器
5. `node src/cli.js login` 后 `data/browser/` 出现 profile;此后 `node src/cli.js run` 能真正领取

## 启用计划任务

```bash
cd <仓库根>
# 1. 确认 config/schedule.json 里 epic-free-games.enabled 是 true(默认 false)
# 2. 确认 %EPIC_DIR% 已在 ~/.config/automation-suite/local-paths.env 里指向本目录
node scripts/apply-schedule.mjs --dry-run        # 先看生成的触发器:09:00 起每 240 分钟,窗口 14 小时
node scripts/apply-schedule.mjs --apply --yes    # 真注册任务 EpicFreeGames
```

Holiday Sale 期间(12 月中旬至 1 月初,每天换一批)把 `intervalMinutes` 从 240 改成 360 再跑一遍上面两条。

## 常见失败

| 现象 | 处置 |
| --- | --- |
| `[跳过] nothing-new` | 正常:当期免费项都领过了。想确认就 `node src/cli.js probe` |
| `[跳过] probe-failed · HTTP ...` | 清单接口不通或被拦;过一会儿重试,或换网络 |
| `需要你处理` 里带 `结账链接:` | 出现 hCaptcha。点开链接手动结账,或换一条出口 IP 再跑 |
| `需要你处理` 里写「登录态已失效」 | 跑 `node src/cli.js login` 人工登录一次 |
| 任务跑了但没动静 | `logs\last-run.log` 与 `logs\runner.log` 看这次为什么跳过(常见:安静时段、内存不足、今日尝试用尽) |
| 浏览器窗口没出现 | 引擎依赖没装全:`npm install` + `npx patchright install chromium` |
| `node src/cli.js link 1` 找不到游戏 | 用 `node src/cli.js probe` 看当期清单;接口按 `EPIC_COUNTRY` 取区域 |
| 想临时停掉 | `node src/cli.js pause`(恢复用 `resume`)或把 `enabled` 改回 false 重跑调度 |
