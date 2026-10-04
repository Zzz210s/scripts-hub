# 上游快照说明

本目录是 [vogler/free-games-claimer](https://github.com/vogler/free-games-claimer)
(AGPL-3.0-only,作者 Ralf Vogler)的一部分,**逐字节原样复制,未做任何修改**。
固定 commit 与升级步骤见上一级目录的 `VENDOR_COMMIT.txt`。

## 收了哪些文件

| 文件 | 为什么要 |
| --- | --- |
| `epic-games.js` | 领取引擎本体:patchright 持久化 profile、登录态检查、遍历免费游戏并完成结账 |
| `src/config.js` | 引擎的环境变量配置(被 `epic-games.js` 与 `src/util.js` import) |
| `src/util.js` | 日志时间、lowdb 封装、`handleSIGINT`、enquirer 提示、apprise 通知 |
| `src/epic-games-mobile.js` | 手机端免费游戏(上游 `EG_MOBILE`,默认开;本项目置 `EG_MOBILE=0`) |
| `LICENSE` | 上游 AGPL-3.0 全文 |

## 没收哪些、为什么

- `prime-gaming.js`、`gog.js`、`aliexpress.js`、`steam-games.js`、`unrealengine.js`:
  别的商店,本项目只做 Epic(目录结构留了扩展位,要加再收)。
- `src/migrate.js`、`src/version.js`:不被 `epic-games.js` import 的独立脚本
  (`version.js` 还会联网查上游 commit)。
- `Dockerfile` / `docker-*` / `.github/` / `eslint.config.js` / `test/`:上游自己的构建与 CI,
  与本仓库的运行方式无关。

## 依赖

引擎运行需要 7 个 npm 包(与上游 dev 的依赖表一致,清单在项目根的 `package.json`):
`patchright`、`otplib`、`chalk`、`dotenv`、`enquirer`、`lowdb`、`fingerprint-injector`。
本项目的**单元测试不依赖它们**(测试只 import 自己的 `src/`,引擎以子进程方式跑并有桩)。

## 引擎的运行时行为(读代码得到,不是猜的)

- 顶层脚本,import 即执行;没有导出的 API,只能当子进程跑。
- 浏览器 `headless` 被上游**写死为 false**(注释:「SHOW=0 will lead to captcha」)——
  真跑时桌面上会出现一个浏览器窗口,这是刻意的反机器人措施。
- 结果落在自己的 lowdb 文件 `data/epic-games.json`:`{ "<账号显示名>": { "<slug>": {title,time,url,status} } }`。
  本项目读取它来归类结果(`BROWSER_DIR` 指到项目自己的 `data/browser`)。
- `NOTIFY` 走外部 `apprise` 命令,本项目不用(置空),通知由本项目的 `src/notify.js` 负责。
- 未登录时:设了 `NOWAIT=1` 就立刻退出 1(本项目无人值守跑法);不设则等人工登录。

## 许可

上游与本目录均为 **AGPL-3.0-only**。本项目目录整体按 AGPL-3.0 授权(见项目根 `LICENSE`),
本仓库其余部分为 GPL-3.0。GPLv3 §13 允许二者组合。
