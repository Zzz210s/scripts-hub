# QUICKSTART — epic-free-games

自动领取 Epic 游戏商城的限时免费游戏,结果推到企业微信;被 hCaptcha 挡住时退化成推预置结账链接。
本目录就在本仓库里(不是生成快照),上游领取引擎原样收编在 `vendor/free-games-claimer/`。

## 第 0 步:拿到项目并进到它的目录

下面所有命令都假设**当前目录是项目根** `proj-epic-free-games/`。从零开始时先做这一步,
否则会掉进最常见的那种失败 —— 在 `~` 里直接跑 `node src/cli.js ...`,报
`Cannot find module 'C:\Users\<你>\src\cli.js'`(那是拿错了目录,不是程序坏了)。

新机器(`git clone`):

```bash
git clone https://github.com/Zzz210s/scripts-hub.git
cd scripts-hub/proj-epic-free-games
```

本机已经克隆过(直接用这个绝对路径):

```bash
cd "C:/Users/23652/home-automation-configs/proj-epic-free-games"
```

进去之后 `pwd` 应指向 `.../proj-epic-free-games`,`ls` 应看到 `src/`、`vendor/`、`package.json`。

不想每次 `cd` 的话,Windows 下用项目自带的快捷入口(内部已 `cd` 到项目根,Git Bash 与 cmd
都能调):

```bat
scripts\windows\epic-status.bat            rem 本地状态与今日尝试次数
scripts\windows\epic-status.bat probe      rem 看当期免费游戏
scripts\windows\epic-login.bat             rem 设备授权登录一次
scripts\windows\epic-run.bat --dry-run     rem 只报告会发什么,不联网
```

`node src/cli.js` 的路径解析以**项目根**为基准(不是当前目录),所以从任何目录执行
`node "C:/.../proj-epic-free-games/src/cli.js" status` 也能跑通;上面那些命令写成
`node src/cli.js ...` 只是因为你已经 `cd` 进来了。

## 前置条件

- Node.js >= 20.11;离线测试零第三方依赖
- 真跑需要引擎依赖:`patchright` 与它的 Chromium(`npm install` + `npx patchright install chromium`)
- 一个 Epic 账号,**跑一次设备授权登录**(`node src/cli.js login`);不保存密码,登录态自动续期
- 机器处于已登录的图形会话;引擎会弹出**可见**的浏览器窗口(上游刻意如此,为了少触发 hCaptcha)

## 三条命令(在项目根里跑)

```bash
npm test                        # 109 条离线测试,不需要凭据、不联网
node src/cli.js status          # 本地状态与今日尝试次数
node src/cli.js probe           # 看当期与预告的免费游戏(只读清单,不登录)
```

迷路了就先看帮助(不会触发任何真实运行):

```bash
node src/cli.js --help
```

一条命令跑完全部自检(测试、干跑、引擎依赖、凭据、登录态):

```bash
bash ../scripts/setup-epic-free-games.sh
```

真跑一次(会打开浏览器并结账),**都在项目根里执行**:

```bash
cd "C:/Users/23652/home-automation-configs/proj-epic-free-games"   # 从零开始时先做
npm install && npx patchright install chromium   # 只需一次;必须在项目目录里跑
node src/cli.js login          # 设备授权登录一次:打印链接与验证码,浏览器确认
node src/cli.js auth           # 确认 token 已落盘且未过期
node src/cli.js run            # 真领一次
```

`npm install` 与 `npx patchright install chromium` **必须在项目目录里跑**:在 `~` 或其他目录跑,
`npm install` 会装到那个目录的 `node_modules`(本项目依赖一条都没装),`npx patchright` 还会把
`patchright` 下到 npx 缓存、Chromium 下到用户级共享缓存 —— 项目这边依旧缺依赖。

## 需要填的凭据

放 `secrets/`(已 gitignore,不会入库):

| 文件 | 必需 | 怎么来 |
| --- | --- | --- |
| `secrets/wecom-webhook.txt` | 否 | 企业微信 App -> 目标群 -> 右上角 `...` -> 群机器人 -> 添加机器人 -> 复制地址;不配则不推送 |
| `secrets/epic-tokens.json` | 否 | 由 `node src/cli.js login` 生成;设备授权拿到的 access / refresh token,有了它就不用人工再登。删掉它则退回浏览器 profile 登录态 |
| `data/browser/`(不是文件,是目录) | 是 | 由登录流程生成;注入的 `EPIC_BEARER_TOKEN` 与降级用的会话在这里,里面没有密码 |

**不需要也不应该存密码。** 程序不会向引擎传 `EG_EMAIL` / `EG_PASSWORD`(上游支持,本项目刻意清空),
登录靠设备授权拿到的 token 自动续期;只有刷新令牌被 Epic 吊销时才需要人重跑一次 `login`。

## 怎么验证跑通了

1. `npm test` 全绿(109 条,不访问网络)
2. `node src/cli.js status` 打印状态文件、账号、今日尝试次数(首次运行显示 0/2)
3. `node src/cli.js probe` 能看到当期免费游戏与预告项,并打印本周期起止时间
4. `node src/cli.js run --dry-run` 只打印「会发什么」,不联网、不起浏览器
5. `node src/cli.js login` 打印链接与验证码,浏览器确认后 `node src/cli.js auth` 能看到账号与到期时间
6. `node src/cli.js run` 能真正领取;`data/browser/` 里是已注入登录态的 profile

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
| `Cannot find module 'C:\Users\<你>\src\cli.js'` | 你在 `~` 或其他目录里跑了命令。先 `cd` 到项目根(见「第 0 步」),或用 `scripts\windows\epic-status.bat` 这类快捷入口 |
| `npm install` 装完还是缺 `patchright` | 它是在别的目录装的。`cd` 到项目根(里面有 `package.json`)再装 |
| `[跳过] nothing-new` | 正常:当期免费项都领过了。想确认就 `node src/cli.js probe` |
| `[跳过] probe-failed · HTTP ...` | 清单接口不通或被拦;过一会儿重试,或换网络 |
| `需要你处理` 里带 `结账链接:` | 出现 hCaptcha。点开链接手动结账,或换一条出口 IP 再跑 |
| `需要你处理` 里写「登录令牌已失效」 | 刷新令牌被吊销。跑 `node src/cli.js login` 重新授权一次 |
| `需要你处理` 里写「下一次触发时自动重试」 | 续期时网络失败,无需操作;持续失败再跑 `login` |
| 任务跑了但没动静 | `logs\last-run.log` 与 `logs\runner.log` 看这次为什么跳过(常见:安静时段、内存不足、今日尝试用尽) |
| 浏览器窗口没出现 | 引擎依赖没装全:`npm install` + `npx patchright install chromium` |
| `node src/cli.js link 1` 找不到游戏 | 用 `node src/cli.js probe` 看当期清单;接口按 `EPIC_COUNTRY` 取区域 |
| 想临时停掉 | `node src/cli.js pause`(恢复用 `resume`)或把 `enabled` 改回 false 重跑调度 |
