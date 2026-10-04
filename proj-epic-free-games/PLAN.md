# Epic 限免自动领取 实现计划(2026-10-06)

> 本文是 `writing-plans` 的产物:任务分解、每步的文件与接口、测试策略、风险。
> 设计依据:`2026-10-05-epic限免设计草案.md`、`2026-10-05-调度配置与epic调研报告.md`。
> 用户已拍板:收编 `vogler/free-games-claimer` epic 引擎(AGPL-3.0)+ 薄壳;
> 接受 Playwright;持久化浏览器 profile 人工登录一次;接 `config/schedule.json`;
> 漏领即错过;先只做 Epic;子目录按 AGPL-3.0 声明。
> 仓库内副本:`proj-epic-free-games/PLAN.md`。

**目标:** 每周四(与 12 月 Holiday Sale 每天)探测 Epic 当期免费游戏,无人值守地用
vogler/free-games-claimer 的 Playwright 引擎自动领取,按企业微信规则推送结果;
被 hCaptcha 挡住时退化为推送预置结账链接。

**架构:** 探测与领取分离。探测是纯 HTTP 且不需要登录(免费清单接口),拿到当期免费项后与本地
状态去重;**只有存在没领过的项才启动引擎**(拉起 patchright 浏览器跑上游 `epic-games.js`),
避免每天多次触发都碰购买链路。引擎结果从上游写的 lowdb 文件与 stdout 归类,再由我们的
通知层按 `docs/wecom-rules.md` 发送。上游代码原样收编进 `vendor/`,我们只写外面一圈。

**技术栈:** Node.js >= 20.11(零依赖 `node:` 模块 + 内置 test runner);引擎侧依赖
patchright / otplib / chalk / dotenv / enquirer / lowdb(上游同一套)。

## Global Constraints

- 不用 emoji;自研文件 ≤200 行(Markdown / 许可证除外)。
- 文案:不用圆括号;补充说明一律 ` · ` 分隔;标题四段式 `<程序名> · <账号或账号数> · <日期> · <动作>`;
  单条 UTF-8 ≤2048 字节。
- 企业微信发送核心 `wecom-core` 必须与另两份实现逐字节一致;`scripts/check-wecom-drift.mjs` 纳入第 3 份。
- 不真连 Epic、不真登录、不真领游戏(测试全部离线,用桩)。
- 不碰 `%WEREAD_DIR%`(微信读书工作区)、`%REWARDS_DIR%`(微软积分工作区)、`scripts/linux/`、本机计划任务。
- 提交用显式路径;不重写历史;推送 `origin`。
- 时间计算不写死北京时刻:按 `America/New_York` 11:00(UTC-4/-5,DST 自适应)。
- 目录隔离:项目目录自带 README / 依赖清单 / 测试 / 许可,不跨项目 import。

---

## 文件结构(先锁定职责,再拆任务)

```
proj-epic-free-games/
├── PLAN.md                     本计划(仓库内副本)
├── README.md / README.zh-CN.md 项目说明(同一模板,双语)
├── QUICKSTART.md               前置条件 / 三条命令 / 凭据 / 验证 / 常见失败
├── LICENSE                     AGPL-3.0 全文(本子目录的许可)
├── NOTICE                      来源与许可说明:上游 repo + commit + 改动声明
├── VENDOR_COMMIT.txt           上游仓库与固定 commit(生成物)
├── package.json                零依赖测试入口 + 引擎运行时依赖清单
├── .gitignore / .gitattributes 排除运行数据;.bat/.vbs/.ps1 强制 CRLF
├── src/
│   ├── config.js               路径与环境解析:根目录、vendor、data、secrets、env 取值
│   ├── clock.js       (纯)     美东时区与换挡点:ET 墙钟、本周期起止、Holiday Sale 窗口
│   ├── promo.js       (纯)     免费清单解析:当前免费项 / 预告项 / slug / 结账链接
│   ├── state.js       (纯+IO)  本地状态:已领记录、当日尝试次数、去重、剪枝、原子写
│   ├── atomic.js      (纯+IO)  原子写文件
│   ├── messages.js    (纯)     四条消息文案:start / result / skip / action
│   ├── policy.js      (纯)     静音跳过原因表、当日限频
│   ├── classify.js    (纯)     引擎结果归类:db 状态 + stdout 特征 -> 每条游戏结论
│   ├── notify.js      (IO)     企业微信发送:wecom-core + 脱敏 + webhook 读取
│   ├── guards.js      (纯)     本地段守卫:安静时段、关机避让、内存、同伴在跑
│   ├── lock.js        (IO)     单实例锁:pid + startedAt,进程实况为准
│   ├── engine.js      (IO)     以子进程跑 vendor 引擎;读上游 lowdb 结果
│   ├── probe.js       (IO)     取免费清单(唯一会发 HTTP 的探测点)
│   ├── run.js         (编排)   探测 -> 判定 -> 通知 -> 引擎 -> 归类 -> 通知 -> 落状态
│   └── cli.js         命令行:run / probe / status / link / login / report / pause / resume
├── scripts/windows/
│   ├── run-daily.bat           任务入口:锁 / 配额 / 内存闸门 -> node src/cli.js run
│   ├── run-daily.vbs           隐藏窗口启动 bat
│   ├── run-state.js            给 bat 用的辅助命令(锁 / 配额 / 内存 / 强杀)
│   ├── install-autostart.ps1   注册计划任务(说明为备用;正规入口是 apply-schedule)
│   └── README-autostart.md     运行器与任务说明
├── test/*.test.js              node --test,全部离线
└── vendor/free-games-claimer/  上游快照(AGPL-3.0 原样,含 LICENSE)
    ├── epic-games.js  src/config.js  src/util.js  src/epic-games-mobile.js
    └── UPSTREAM.md             收了哪些文件、为什么、没改哪里、怎么升级
```

我们**不改上游逻辑**;上游顶层脚本会写 `vendor/free-games-claimer/data/`(lowdb + 浏览器 profile),
该目录 gitignore。`BROWSER_DIR` 指到我们自己的 `data/browser`。

---

## 任务分解

### Task 1: 项目骨架与计划(commit 1)

**产出:** `proj-epic-free-games/{PLAN.md,package.json,.gitignore,.gitattributes}`。

- `package.json`:`"type":"module"`、`"private":true`、`engines.node >= 20.11`、`scripts.test = "node --test test/*.test.js"`,
  dependencies 列上游引擎所需的 6 个包(patchright / otplib / chalk / dotenv / enquirer / lowdb)。
  测试不需要它们,`npm test` 在未 `npm install` 时也能跑。
- `.gitignore`:`data/`、`logs/`、`secrets/`、`node_modules/`、`vendor/free-games-claimer/data/`、
  `vendor/free-games-claimer/node_modules/`、`*.local`。
- `.gitattributes`:`.bat/.cmd/.vbs/.ps1 text eol=crlf`(Windows 脚本必须 CRLF,否则 `goto`/标签会出问题)。

### Task 2: 收编上游引擎(commit 2)

**产出:** `vendor/free-games-claimer/{epic-games.js,src/{config,util,epic-games-mobile}.js,LICENSE,UPSTREAM.md}` + `VENDOR_COMMIT.txt`。

- 上游:`https://github.com/vogler/free-games-claimer`,取 **dev 分支** commit
  `f282d3cca93b4b7ff68fa6b647cf0f11520b4273`(2026-09-02)。理由:`main` 停在 2025-05-16 的 v1.4.0,
  dev 领先 141 个提交且含 epic 领取的关键修复("getGameUrls from json since webpage was giving 404s"、
  "fix detecting successful claim");README 里 GitHub 的 `pushedAt 2026-09-02` 正是 dev。
- 逐字节复制,不改一行;`UPSTREAM.md` 记录取哪些文件、为什么不含 `prime-gaming.js`/`gog.js`
  与 `src/{migrate,version}.js`、升级步骤、许可。

### Task 3: 纯函数层 + 测试(commit 3 的前半)

TDD:每条先写失败测试,再写最小实现。测试文件与断言点:

1. `test/clock.test.js`
   - 2026-10-01T15:00:00Z 是周期边界(周四 11:00 EDT);2026-10-01T14:59:59Z 仍属上一周期。
   - 夏令时结束(2026-11-01)后:2026-11-05 的边界是 16:00Z(EST)。
   - 夏令时开始(2026-03-08)后:2026-03-12 的边界是 15:00Z(EDT)。
   - `cycleStart`/`cycleEnd` 相差 7 天;`isHolidaySale` 在 12-15 与 01-03 为真、10-06 为假。
2. `test/promo.test.js`
   - 只认 `discountPercentage === 0` 且在窗口内的项;打折 50% 的项不算。
   - 预告项走 `upcomingPromotionalOffers`,start 在未来。
   - `offerSlug` 优先级:`catalogNs.mappings[productHome].pageSlug` > 同一数组首项 >
     `offerMappings` 同理 > `productSlug` 去掉 `/home` 尾 > `urlSlug`。
   - `checkoutUrl`:有 `namespace`+`id` 时给 `https://www.epicgames.com/store/purchase?offers=1-<ns>-<id>`,
     否则退回商店页 URL。
   - 空体 / 非 JSON / 缺 `data.Catalog.searchStore.elements` 一律返回空且 `ok:false`,不抛。
3. `test/state.test.js`
   - 已 `claimed` / `existed` 的 slug 不再出现在 `pending`。
   - `pending` 只含当期免费项中未领过的。
   - `recordAttempt` 当天累加、跨天归零;`maxAttemptsPerDay` 到点后 `canAttempt` 为假。
   - `prune` 丢掉超过 N 天的已领记录。
   - 写入后重读一致(tmpdir);坏 JSON 时回退空状态而不是抛。
4. `test/messages.test.js`
   - 四条消息**都不含圆括号**、不用 emoji;标题行四段、以 ` · ` 分隔。
   - `result` 成功/有失败的动作词;`skip` 三段结构固定末行 `你需要做什么:不需要`;
     `action` 首行正文是 `请你:`,并带 `结账链接:` 行。
   - 超长标题截断后仍 ≤2048 字节且不以半个汉字结尾。
5. `test/policy.test.js`
   - 静音表:`nothing-new` / `already-attempted` / `peer-running` 静音;`low-memory` /
     `attempts-exhausted` / `probe-failed` 要推。`shouldNotifyOnce` 同因同日只一次。
6. `test/classify.test.js`
   - db 里 `claimed` -> `claimed`;`existed` / `manual` -> `existed`;
     `unavailable-in-region` -> `unavailable`;`failed:requires-base-game` -> `requires-base-game`;
     `failed` -> `failed`;db 无记录 + 期望领取 -> `pending`(引擎没走到)。
   - stdout 含 `h_captcha` / `captcha` -> `captcha:true`;含 `Not signed in anymore` -> `loginRequired:true`。
7. `test/notify.test.js`
   - `clampText` 按 UTF-8 字节截断,超长以 `...` 结尾且总长 ≤ 上限;不切半个汉字。
   - 注入 `fetchImpl`:`errcode=0` 成功;`errcode=45009` 退避重试后成功(退避 1s→2s,注入 sleep);
     其余 `errcode` 不重试;超时按可重试处理;`maskSecret` 把 `key=` 脱敏。
8. `test/guards.test.js`
   - `quietHours` 命中 20:00-23:00;`shutdownGuard` 距 02:00 不足 30 分钟命中;内存阈值两档。
9. `test/run.test.js`(编排,注入桩)
   - 无新限免:不发任何消息、不启动引擎、状态写 `checkedAt`、退出码 0。
   - 有新限免:发 start -> 引擎(桩返回 db)-> 发 result;状态标 `claimed`。
   - 引擎报 captcha:发 `action`,带结账链接,状态仍为未领,退出码非 0。
   - 当天尝试次数用尽:静音跳过,不启动引擎。
   - 探测失败:推一条 skip,不启动引擎。

### Task 4: CLI、运行器与 Windows 任务(commit 3 的后半)

**产出:** `src/cli.js`、`src/run.js`、`src/engine.js`、`src/probe.js`、`src/notify.js`、`src/lock.js`、
`src/guards.js`、`scripts/windows/*`。

接口(实现前先定名,后续任务按此):

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `loadConfig(env?)` | `-> {root, vendorDir, dataDir, secretsDir, browserDir, webhookFile, ...}` | `src/config.js` |
| `etParts(date)` | `-> {year,month,day,weekday,hour,minute}` | 美东墙钟 |
| `cycleStart(now)` / `cycleEnd(now)` | `-> Date` | 最近的周四 11:00 ET 边界 |
| `isHolidaySale(now)` | `-> boolean` | 12-10 至 01-07(美东) |
| `parseFreeGames(json, now)` | `-> {ok, current[], upcoming[]}` | 纯 |
| `currentFreeGames(json, now)` / `upcomingFreeGames(json, now)` | `-> Game[]` | 纯 |
| `checkoutUrl(game)` | `-> string` | 预置结账链接,缺失时退回商店页 |
| `emptyState()` / `loadState(file)` / `saveState(file, state)` | | 原子写 |
| `pendingGames(state, games)` | `-> Game[]` | 去重 |
| `canAttempt(state, now, max)` / `recordAttempt(state, now)` | | 当日配额 |
| `markGame(state, game, status, now)` / `pruneState(state, now, days)` | | 状态维护 |
| `buildStartMessage({date, account})` | `-> string` | 文案 |
| `buildResultMessage({date, games, cycleEnd})` | `-> string` | 文案 |
| `buildSkipMessage({date, reason, cycleEnd})` | `-> string` | 文案 |
| `buildActionMessage({date, items})` | `-> string` | 文案 |
| `isSilentSkip(reason)` / `shouldNotifyOnce(state, key, date)` | | 策略 |
| `summarizeRun({expected, db, stdout, code})` | `-> {games[], captcha, loginRequired, ok}` | 归类 |
| `sendWecom(text, options)` | `-> {ok, error?}` | 通知 |
| `shouldSkipLocally({env, now})` | `-> {skip, reason, detail}` | 守卫 |
| `probe(runner?)` | `-> {ok, current[], upcoming[], error?}` | IO |
| `runEpicEngine(config, env?)` | `-> {code, stdout}` | IO |
| `runOnce({deps, argv})` | `-> {code, messages[]}` | 编排 |

CLI 子命令:
- `run` 默认;`run --dry-run` 只打印将发的消息、不联网、不起浏览器。
- `probe` 只取清单并打印当期项与预告项。
- `status` 打印本地状态与当日尝试次数。
- `link <slug|序号>` 打印结账链接(退化路径手动用)。
- `login` 跑一次引擎并放宽登录等待(`NOWAIT` 不设、`LOGIN_TIMEOUT=600`),供人工登录一次。
- `report` 打印当前状态摘要;`pause` / `resume` 写状态里的暂停位。

`run-daily.bat`:沿用微信读书那套形态(锁 -> 配额 -> 内存 -> 看门狗 -> `node src/cli.js run`,
日志 `logs/last-run.log`);`run-state.js` 提供 `lock|unlock|lock-status|quota|free-mem|kill|pids`,
锁文件 `logs/run.lock`(`{"pid","startedAt"}`),`WEREAD_RUN_MATCH` 同思路用 `EPIC_RUN_MATCH` 匹配
`epic-games.js` 进程。

`install-autostart.ps1`:注册 `EpicFreeGames` 任务(登录后 17 分钟 + 09:00 起每 240 分钟、14 小时窗口)。
**说明为备用**:正规入口是 `node scripts/apply-schedule.mjs --apply --yes`。

### Task 5: 接入合集层(commit 4)

1. `config/schedule.json` + `config/schedule.example.json` 追加 `epic-free-games`:
   `order` 末尾、`taskName: EpicFreeGames`、`startTime: auto`(=> 09:00)、
   `intervalMinutes: 240`、`windowHours: 14`、`maxAttemptsPerDay: 2`、
   `logonDelayMinutes: auto`、`actionVbs: %EPIC_DIR%\scripts\windows\run-daily.vbs`、
   **`enabled: false`**(未人工登录前不注册),`_readme` 说明 Holiday Sale 期间改 360。
2. `scripts/check-wecom-drift.mjs`:`FILES` 加第 3 份 `proj-epic-free-games/src/notify.js`。
3. `scripts/setup-epic-free-games.sh`:照 `setup-autovisor.sh` 的形态做离线自检
   (Node 版本、目录、`npm test`、`node src/cli.js probe --dry-run`、引擎依赖是否装了、凭据是否就位)。
4. `scripts/check-privacy.mjs`:无需改(它扫全部 `git ls-files`);推前跑一次。
5. 文档:`README.md` / `README.zh-CN.md` 项目表与目录树加一行;`docs/automation-overview.md`
   第 1/2/3/11 节加 Epic;`docs/scheduling-convention.md` 第 1 节表加行;
   `docs/notification-convention.md` 消息类型表加列;`docs/wecom-rules.md` 第 1 节实现表加行;
   `docs/credentials.md` 加 Epic 段;`docs/workspace-model.md` 说明本项目是仓库内手写(非快照);
   `scripts/README.md` 登记 `setup-epic-free-games.sh`;`proj-epic-free-games/README.md`+
   `README.zh-CN.md`+`QUICKSTART.md`。
6. **无 `sync-*.sh`**:本项目的权威副本就是仓库自身(与 `proj-autovisor/` 同类),README 里写明
   将来若要拆出独立工作区该怎么做(`sync-epic-free-games.sh` 的形态照 `sync-weread-signin.sh`)。

### Task 6: 验证与提交

- `npm test`(项目内)`node --test test/*.test.js` 全绿。
- `bash -n scripts/*.sh scripts/lib/*.sh`、`shellcheck` 无输出。
- `node --check` 全部 `scripts/**/*.mjs` 与 `proj-epic-free-games/src/*.js`。
- `node scripts/check-wecom-drift.mjs`(3 份)、`node scripts/check-privacy.mjs` 通过。
- `node scripts/apply-schedule.mjs --dry-run` 生成 3 个任务、Epic 为 `[跳过]`(enabled false)。
- 微信读书与微软积分的测试不被破坏(`proj-weread-signin`: `npm test` 应仍全绿)。
- 分批提交:计划 / 引擎收编 / 壳与测试 / 集成与文档,各一行中文 conventional commit,显式路径。

## 风险与对策

| 风险 | 对策 |
| --- | --- |
| hCaptcha 挡领取 | 失败即退化:发 `action` + 预置结账链接;不重试、不刷 |
| 第 3 份 `wecom-core` 与另两份漂移 | 逐字节复制;`check-wecom-drift.mjs` 纳入第 3 份(纯加法,不动两份快照) |
| 块内注释只列了两份实现 | 不改快照文件(改了会被下次 `sync-*` 回退,成为漂移地雷);在块外补一行说明并写进 README |
| 上游 dev 分支而非 main | README/`UPSTREAM.md`/`VENDOR_COMMIT.txt` 三处记录分支与 commit,便于升级 |
| 换挡时刻误算(DST) | 单一 `etParts` 实现;三个 DST 边界断言钉死 |
| 引擎写死 `headless:false` | 接受(上游为压 hCaptcha 刻意如此);QUICKSTART 明确"会弹出一个浏览器窗口" |
| 计划任务默认关闭 | `enabled:false`;QUICKSTART 给出"人工登录 -> 开 enabled -> apply-schedule"的确切命令 |
| 上游接口字段变动 | `parseFreeGames` 对缺字段/非 JSON 全部返回 `ok:false`,不抛;失败推一条 skip |

## 未做 / 明确不做

- 不做补领(Epic 过期不可领,做不到);不做多账号;不碰付费商品;不收 Prime Gaming / GOG。
- 不实现 `sync-*` / `deploy-*`(权威副本在仓库内);不改 `scripts/linux/`。
- 不真连 Epic、不真登录、不真领游戏。
