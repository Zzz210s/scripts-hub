# proj-bilibili-tasks 实现计划(2026-10-11)

> 本文是 `writing-plans` 的产物:任务分解、每步的文件与接口、测试策略、验证命令、部署与回滚。
> **设计依据(唯一真源)**:`<笔记库>/记录/自动化脚本项目/2026-10-11-proj-bilibili-tasks设计.md`
> (下称「设计文档」;本文只写"怎么做",不复述"为什么"。两份冲突时以设计文档为准,并把设计文档一起改掉)。
> 事实来源(调研笔记,都是只读事实核查):
> - `<笔记库>/记录/自动化脚本项目/2026-10-10-B站与美团自动化可行性.md`
> - `<笔记库>/记录/自动化脚本项目/2026-10-10-BiliBiliToolPro事实核实.md`
> - `<笔记库>/记录/自动化脚本项目/2026-10-11-B站大会员与投币任务细节.md`
> 用户已拍板:复用 `RayWangQvQ/BiliBiliToolPro`(GPL-3.0)+ 自建 Console 镜像 + Node 薄壳;
> 任务开关矩阵见设计文档 §6;**B币券由薄壳实现**;投币 ≤5 枚/天且只要关注的 UP;
> 凭据靠服务器上扫码登录;通知进企业微信第 4 份核心块 + 新群机器人;并入套件的 08:00/12:00 队列。

**目标:** 每天无人值守地拿满 B站每日经验(登录 5 + 观看 5 + 分享 5 + 投币 50),
顺手做掉纯获取型的 `VipBigPoint` / `Manga` / `MangaPrivilege`,由薄壳判会员状态并领年度大会员的
B币券,结果按企业微信规则推送;零消耗、零破坏性动作。

**架构:** 薄壳(自研 Node,零依赖)+ 上游 .NET Console(固定 commit,进程边界调用)。
薄壳负责:守卫链 -> 会员/券/余额预检 -> 领券 + 自证 -> 拉 Console 跑任务(注入开关矩阵环境变量)
-> 归类退出码与 stdout 特征 -> 四条消息 -> 原子落状态。上游 13 个通知 sink 全关,企业微信只由薄壳发。
运行形态沿用套件的一次性容器:`automation-suite.timer` -> `run-all.sh` -> `bilibili/run.sh` ->
`docker compose run --rm bilibili-run` -> 容器内 `node src/cli.js run`。

**技术栈:** 容器内 `.NET 10 runtime`(上游 Console)+ `Node ≥ 20.11`(薄壳,`node:` 内置 + 内置 test runner)。

## Global Constraints

- 不用 emoji;自研代码文件 ≤200 行(含注释与空行;Markdown / LICENSE 不受限);超过就按单一职责拆文件。
- 零第三方依赖:薄壳只用 `node:` 内置模块;**`npm test` 在没跑过 `npm install` 时也必须能跑**。
- 文案硬规则:不用圆括号;补充说明一律 ` · ` 分隔;标题四段式 `<程序名> · <账号或账号数> · <日期> · <动作>`;
  单条 UTF-8 ≤2048 字节;缩进的解释行两个空格开头。程序名统一 **`B站任务`**。
- `wecom-core` 必须与既有 3 份**逐字节一致**;`scripts/check-wecom-drift.mjs` 纳入第 4 份。
  **块内那行"只列两份实现"的注释要原样保留** —— 纠正说明只能写在块外(照 `proj-epic-free-games/src/notify.js` 的头部)。
- **不真连 B站、不真跑上游任务、不用真实账号、不连服务器、不构建镜像**(本阶段)。
- 只跑离线测试;网络用注入的 `fetchImpl`,子进程用注入的 `spawnImpl`,时间用 `now` 参数。
- 只做加法:不改 `scripts/linux/` 里既有程序的行为与顺序;与另一会话冲突就停下报告。
- 提交用显式路径(`git commit -- <路径>`);不重写历史;推 `origin`;推前 `git grep` 隐私复查。
- 目录隔离:项目目录自带 README / 依赖清单 / 测试 / 许可;不跨项目 import。
- 本机 Git 全局是 `core.autocrlf=true` —— 仓库根 `.gitattributes` 已锁 LF,新目录不要再引入 CRLF 抖动。

---

## 文件结构(先锁定职责,再拆任务)

```
proj-bilibili-tasks/
├── PLAN.md                      本计划(仓库内副本)
├── README.md / README.zh-CN.md  项目说明(同一模板,双语,顶部互链)
├── QUICKSTART.md                前置条件 / 扫码登录 / 三条命令 / 验证 / 常见失败
├── LICENSE                      GPL-3.0 全文(与上游一致,设计文档 D12)
├── NOTICE                       来源与许可:上游 repo + commit 2db0fc613f + 我们的改动声明
├── VENDOR_COMMIT.txt            RayWangQvQ/BiliBiliToolPro @ 2db0fc613f(2026-10-08T14:37:35Z)
├── package.json                 零依赖;仅有 test 入口
├── .gitignore                   data/ logs/ secrets/ node_modules/ *.local
├── .gitattributes               .bat/.cmd/.vbs/.ps1 text eol=crlf(其余沿用根配置)
├── src/
│   ├── config.js                §5.3 的环境变量与默认值
│   ├── clock.js       (纯)      逻辑日 04:00 边界、dayKey、dateText
│   ├── member.js      (纯)      nav -> {tier,isVip,notLoggedIn}(设计文档 §7.1)
│   ├── voucher.js     (纯)      privilege/my -> {shouldReceive,...}(设计文档 §5.2)
│   ├── donate.js      (纯)      {balance,threshold,max} -> {target,stop,reason}
│   ├── classify.js    (纯)      (exitCode,stdout) -> 结论与失败分类(设计文档 §9.3)
│   ├── messages.js    (纯)      start / result / skip / action 四条文案
│   ├── policy.js      (纯)      静音跳过原因表 + ACTION_KINDS + isSilentSkip
│   ├── state.js       (纯+IO)   原子 JSON:lastRunDay / days / coinLedger / voucherHistory
│   ├── atomic.js      (纯+IO)   原子写(Windows 下 rename 覆盖重试)
│   ├── guards.js      (纯)      paused/done-today/attempts-exhausted/peer-running/quiet-hours/before-shutdown/low-memory
│   ├── notify.js      (IO)      第 4 份 wecom-core + maskSecret + loadWebhook + sendWecom
│   ├── api.js         (IO)      nav / privilege my+receive / getCoin / followings;fetchImpl 可注入
│   ├── lock.js        (IO)      单实例锁(pid + startedAt)+ 同伴锁按 mtime 判活
│   ├── console-runner.js (IO)   spawn Console,注入开关矩阵 env,收 stdout,超时杀
│   ├── login.js       (IO)      spawn Console 跑 Login,抽 tool.lu 链接,回写 cookies.json
│   ├── run.js         (编排)    守卫 -> start -> 券预检+领取+自证 -> Console -> 归类 -> result -> 落状态
│   └── cli.js         CLI       run / login / status / cookies / check / pause / resume
├── scripts/windows/
│   ├── run-daily.bat            任务入口:锁 / 配额 / 内存闸门 -> node src/cli.js run(**注释只用 ASCII**)
│   ├── run-daily.vbs            隐藏窗口启动 bat
│   ├── run-state.js             给 bat 用的辅助命令(lock / unlock / quota / free-mem / kill / pids)
│   └── README-autostart.md      运行器与任务说明(备用入口)
├── test/*.test.js               node --test,全部离线(清单见 Task 2/3/4)
└── (不放 deploy/ —— 容器入口的单一真源在 scripts/linux/bilibili/deploy/,见下)

**容器入口只放一处(设计定,与附件第 12 节列的两处不同)**:附件的文件树里 `proj-bilibili-tasks/deploy/`
与 `scripts/linux/bilibili/deploy/` 都列了 `run-once.sh`,两份会漂移。本项目定在
**`scripts/linux/bilibili/deploy/run-once.sh`**(与它的 `Dockerfile`、`run.sh` 同处),部署时与 `Dockerfile`
一起放进服务器应用目录 `/srv/apps/automation/bilibili/`。`proj-epic-free-games` 把 `run-once.sh` 放在项目目录里,
那是它自己的选择;本项目全部容器骨架只放 `scripts/linux/bilibili/` 一处。

scripts/linux/bilibili/
├── Dockerfile                   multi-stage:sdk:10.0 -> runtime:10.0 + node 二进制
├── run.sh                       宿主侧:flock -> 日志轮转 -> compose run(带看门狗)-> 兜底提醒
└── deploy/run-once.sh           容器内入口(cookies.json 复制进/出 + exec node src/cli.js run)

scripts/setup-bilibili-tasks.sh  离线自检(Node 版本 / 目录 / npm test / run --dry-run / 凭据是否就位)
scripts/sync-bilibili-tasks.sh   校验型(设计文档 D5):不复制文件,只做自洽校验
```

`compile` 到容器的两份拷贝在部署时组装:`/srv/apps/automation/bilibili/{src,deploy,Dockerfile}`。

---

## 任务分解

### Task 1: 项目骨架与许可(commit 1)

**产出:** `proj-bilibili-tasks/{PLAN.md,package.json,.gitignore,.gitattributes,LICENSE,NOTICE,VENDOR_COMMIT.txt}`。

`package.json`(零依赖,这是刻意的 —— `wecom-core` 与本项目全部逻辑都用 `node:` 内置):

```json
{
  "name": "bilibili-tasks",
  "version": "1.0.0",
  "private": true,
  "description": "Unattended Bilibili daily tasks and annual-VIP voucher claim, driven by a thin Node shell over BiliBiliToolPro with WeCom notifications.",
  "type": "module",
  "license": "GPL-3.0-only",
  "engines": { "node": ">=20.11.0" },
  "scripts": { "test": "node --test test/*.test.js" }
}
```

- `.gitignore`:`data/`、`logs/`、`secrets/`、`node_modules/`、`*.local`。
- `.gitattributes`:`*.bat text eol=crlf`、`*.vbs text eol=crlf`、`*.ps1 text eol=crlf`、`*.sh text eol=lf`。
- `LICENSE` = GPL-3.0 全文(从 `proj-epic-free-games/../LICENSE` 或本机已有的 GPL 文本取,不要手抄)。
- `NOTICE` 内容(四段,照 `proj-epic-free-games/NOTICE` 的行文):

```
本目录的镜像与代码使用了上游项目:
  RayWangQvQ/BiliBiliToolPro   https://github.com/RayWangQvQ/BiliBiliToolPro
  固定 commit                  2db0fc613f (2026-10-08T14:37:35Z)
  许可                         GPL-3.0

我们做了什么:不修改上游任何代码,以「进程 + HTTP」边界调用它的 Console 程序
(dotnet Ray.BiliBiliTool.Console.dll --runTasks=...)。上游源码只在构建镜像时取用,
不进本仓库。本目录的自研代码以 GPL-3.0 发布以保持许可一致。

镜像不对外分发(自用),因此不触发 GPL-3.0 的分发附源码义务;若将来要分发,
必须同时提供上游对应 commit 的完整源码与我们的构建脚本。
```

- `VENDOR_COMMIT.txt`:`RayWangQvQ/BiliBiliToolPro 2db0fc613f`(单行 + 日期;Dockerfile 里的 sha 必须与它一致)。

### Task 2: 纯函数层 + 单测(commit 2)

TDD:**每条先写失败测试,再写最小实现。** 目录 `src/` + `test/`。

**TDD 步骤与断言点:**

1. `test/clock.test.js`(-> `src/clock.js`):`2026-10-11T03:59+08:00` 与 `04:00` 分属两个逻辑日;
   `dayKey` 输出 `YYYY-MM-DD`;`dateText(new Date('2026-10-11T05:00:00+08:00')) === '2026-10-11'`。
2. `test/member.test.js`(-> `src/member.js`):`vipStatus` 0/1 × `vipType` 0/1/2 六种组合;
   `vipStatus=0 && vipType=2` -> `tier:'none'`(门控);`isLogin=false` -> `notLoggedIn:true` 且 `tier:'none'`;缺字段不抛。
3. `test/voucher.test.js`(-> `src/voucher.js`):`state` 0/1/2/未知;`list` 为空;没有 `type===1`;
   多项 `type===1` 且 state 混合时 `shouldReceive === (可领数 > 0)`、`count` 等于可领数、`state` 是第一条的。
4. `test/donate.test.js`(-> `src/donate.js`):`balance=0` -> `balance-zero`;`balance=20`(=`threshold`)-> `below-threshold`;
   `balance=21` -> `target=1`;`balance=100` -> `target=5`(封顶);`threshold=0` -> 等价上游默认行为。
5. `test/classify.test.js`(-> `src/classify.js`):`-403` 同行含 `分享` 命中 `risk403`;**裸 `-403`(如余额行)不命中**;
   `352` 同上;`6007000` -> `bigPointFlaky`;`69801` / `你已领取过该权益` -> `voucherTaken`;
   `账号未登录` -> `cookieInvalid`;退出码 0 -> `ok:true`;退出码 1 无特征 -> `ok:false` 且 `failures` 非空。
6. `test/messages.test.js`(-> `src/messages.js`):四条消息**都不含 `(` 与 `)`**、不含 emoji;
   标题四段、以 ` · ` 分隔;`result` 成功/有失败的动作词;`action` 首行正文是 `请你:`;
   长标题截断后 `Buffer.byteLength(text,'utf8') <= 2048` 且不以半个汉字结尾(`!text.endsWith('\uFFFD')`)。
7. `test/policy.test.js`(-> `src/policy.js`):`isSilentSkip` 对七个原因都返回 true;
   `ACTION_KINDS` 的 `login` / `cookie-invalid` / `risk-blocked` 都有 `please` / `reason` / `consequence` 三段且都不含圆括号。
8. `test/guards.test.js`(-> `src/guards.js`):七个守卫各命中一次;顺序固定(只报第一个命中的原因);
   `done-today` 只在 `lastRunDay === dayKey(now) && lastResult === 'success'` 时命中;
   阈值断言 `20:00-23:00` / `02:00` 前 30 分钟 / `800MB`。
9. `test/state.test.js`(-> `src/state.js` + `src/atomic.js`):坏 JSON 回退空状态不抛;
   `attempts` 跨天归零;`coinLedger` / `voucherHistory` 剪枝到 90 条;写后重读一致(tmpdir);
   原子写覆盖已存在文件;注入 `fsImpl` 让 `rename` 抛一次 `EPERM` -> 重试后成功。
10. `test/config.test.js`(-> `src/config.js`):`BILIBILI_DIR` 覆盖 root;`coinKeep` / `coinMax` /
    `consoleTimeoutMinutes` / `maxAttempts` 的默认值与覆盖;`consoleDir` 默认 `/app`。

**接口(实现前先定名,后续任务按此):**

| 函数 | 签名 | 文件 |
| --- | --- | --- |
| `dayKey(now)` / `dateText(now)` | `-> 'YYYY-MM-DD'` | `clock.js` |
| `memberFromNav(navJson)` | `-> {tier,isVip,notLoggedIn}` | `member.js` |
| `voucherDecision(myJson)` | `-> {shouldReceive,alreadyReceived,state,nextReceiveDays,expireTime,count}` | `voucher.js` |
| `coinTarget({balance,threshold,max})` | `-> {target,stop,reason}` | `donate.js` |
| `classifyRun({exitCode,stdout})` | `-> {ok,failures[],risk403,cookieInvalid,shareFailed,watchFailed,task352,bigPointFlaky,voucherTaken,timedOut}` | `classify.js` |
| `buildStartMessage({date,accounts})` / `buildResultMessage({...})` / `buildSkipMessage({...})` / `buildActionMessage({date,kind,detail})` | `-> string` | `messages.js` |
| `isSilentSkip(reason)` / `actionText(kind)` / `reasonText(reason)` / `followUpText(reason)` | — | `policy.js` |
| `emptyState()` / `loadState(file)` / `saveState(file,state)` / `attemptsToday` / `recordAttempt` / `notifiedOnce` / `markNotified` / `setPaused` | — | `state.js` |
| `readJsonSafe(file,fallback)` / `writeAtomic(file,text,{fsImpl})` | — | `atomic.js` |
| `shouldSkipLocally({...})` / `quietHours` / `shutdownGuard` / `memorySkip` / `DEFAULT_LIMITS` | — | `guards.js` |

**可粘贴的关键配置 —— 状态形状(`state.js` 的 `emptyState()`,设计文档 §11.1):**

```js
export function emptyState(now = new Date()) {
    return {
        version: 1,
        updatedAt: now.toISOString(),
        paused: false,
        account: '',
        lastRunDay: null,
        lastResult: null,
        days: {},          // { 'YYYY-MM-DD': { attempts, notified: {}, checkedAt } }
        coinLedger: [],    // [{ day, balance, target, stop }]   保留最近 90 条
        voucherHistory: [] // [{ day, action, state, expireTime, nextReceiveDays }] 保留最近 90 条
    }
}
```

### Task 3: IO 层(commit 3)

**产出:** `src/{notify.js,api.js,lock.js,console-runner.js,login.js}` + 对应测试。

**TDD 步骤与断言点:**

1. `test/notify.test.js`(-> `src/notify.js`):
   - `wecom-core` 块**整段从 `proj-epic-free-games/src/notify.js` 复制**(含块内那行老注释),一个字都别改;
   - 注入 `fetchImpl`:`{errcode:0}` -> `{ok:true}`;`45009` -> 注入的 `sleep` 被调两次后成功(退避 1s->2s);
     其它 `errcode` -> 立即 `{ok:false, errcode}`;超时(`AbortError`)-> 按可重试处理;
   - `maskSecret` 把 `key=abcdef` 变成 `key=****`;`clampText` 按 UTF-8 截断,总长 ≤2048 且不切半个汉字;
   - 没有 webhook `key=`、本机用户目录路径、盘符绝对路径。
2. `test/api.test.js`(-> `src/api.js`):注入 `fetchImpl` 逐接口断言 URL 与请求头;
   `getCoin` 非 2xx -> 回落 `nav.data.money`;两者都失败 -> `{ok:false}`;
   `followings` 有 `data.total` 用 total,没有则用 `data.list.length`;
   `readCookie` 从 `{"BiliBiliCookies":["SESSDATA=..; bili_jct=..; DedeUserID=12345;"]}` 抽出 `{mid:'12345', csrf:'..'}`。
3. `test/lock.test.js`(-> `src/lock.js`):锁文件形状 `{"pid","startedAt"}`;pid 不存活 -> 可接管(记 `stale:true`);
   同伴锁按 `mtime` 判活(90 分钟内算在跑)—— 与 epic 的判据一致。
4. `test/console-runner.test.js`(-> `src/console-runner.js`):注入 `spawnImpl`,断言拼出的 env
   **逐条**等于设计文档 §6.2/§6.3 的矩阵;stdout 被逐行回调;超时被杀 -> `{timedOut:true}`;
   env 里出现非空 `Serilog__WriteTo*` -> 抛 `config-invalid`(D15);`cwd` 等于 `config.consoleDir`。
5. `test/login.test.js`(-> `src/login.js`):注入 `spawnImpl`,stdout 里混着二维码块字符时正确抽出
   `https://tool.lu/qrcode/basic.html?text=...`;退出码 0 且出现新 `DedeUserID` -> `{ok:true, mid}`;
   超时/退出码 1 -> `{ok:false}` 并给出"请重跑"文案。

**可粘贴的关键配置 —— 开关矩阵 env(`console-runner.js` 的 `buildEnv(cfg, coinTarget)`):**

```js
export function buildConsoleEnv(cfg, { coinTarget, accounts = 1 } = {}) {
    return {
        // 任务清单:只跑这四个(设计文档 §6.1)
        Ray_RunTasks: 'Daily&VipBigPoint&Manga&MangaPrivilege',
        // 双保险:打开的都显式 true,关掉的一个不漏
        Ray_DailyTaskConfig__IsEnable: 'true',
        Ray_VipBigPointConfig__IsEnable: 'true',
        Ray_MangaTaskConfig__IsEnable: 'true',
        Ray_MangaPrivilegeTaskConfig__IsEnable: 'true',
        Ray_VipPrivilegeConfig__IsEnable: 'false',   // B币券由薄壳实现
        Ray_ChargeTaskConfig__IsEnable: 'false',
        Ray_Silver2CoinTaskConfig__IsEnable: 'false',
        Ray_UnfollowBatchedTaskConfig__IsEnable: 'false',
        Ray_LiveFansMedalTaskConfig__IsEnable: 'false',
        Ray_LiveLotteryTaskConfig__IsEnable: 'false',
        // 投币:数量由薄壳算;不点赞;保留值作第二道
        Ray_DailyTaskConfig__IsWatchVideo: 'true',
        Ray_DailyTaskConfig__IsShareVideo: 'true',
        Ray_DailyTaskConfig__SelectLike: 'false',
        Ray_DailyTaskConfig__NumberOfCoins: String(coinTarget.target),
        Ray_DailyTaskConfig__NumberOfProtectedCoins: String(cfg.coinKeep),
        Ray_DailyTaskConfig__SupportUpIds: '',            // 空:上游没有排他白名单,别让它看起来像
        // 安全与自动补做
        Ray_Security__RandomSleepMaxMin: '0',
        Ray_AutoRecoverConfig__IsEnable: 'false'
        // 不设任何 Serilog__WriteTo*(D15 有前置断言)
    }
}
```

### Task 4: 编排与 CLI(commit 4)

**产出:** `src/run.js`、`src/cli.js` + `test/run.test.js`、`test/cli.test.js`。

**`runOnce` 的步骤(顺序固定,照设计文档 §11.4):**

1. `loadState` -> 若 `cookiesFile` 不存在 -> `no-credentials` **静音**跳过(返回 0,不发消息,不算失败);
2. `shouldSkipLocally({lastRunDay,lastResult,now,paused,attempts,maxAttempts,peerRunning,freeMb})` -> 命中就写日志返回 0;
3. `acquireLock` -> 拿不到锁 -> `peer-running` 静音跳过;
4. `api.fetchNav` -> `memberFromNav`;
   - `notLoggedIn` -> **不**发 `start`,直接发 `action:cookie-invalid`,记 `lastResult='failure'`,返回非 0;
5. 发 `start`;
6. `api.fetchVoucher` -> 年度会员且 `shouldReceive` -> `receiveVoucher` -> 再 `fetchVoucher` 自证;
   非年度 -> 记 `voucherHistory: skipped-none`;
7. `api.fetchCoin`(回落链见 D14)+ `api.fetchFollowingsTotal` -> `coinTarget`(关注数 0 或未知 -> `target=0`);
8. `console-runner.runConsole(...)` -> 收 stdout 与退出码;
9. `classifyRun({exitCode,stdout})` -> 拼 `buildResultMessage`;
10. 发 `result`;`recordAttempt`;写 `coinLedger` / `voucherHistory`;`lastRunDay` / `lastResult`;
11. 返回 `{code, messages}`。

**`cli.js`:** 子命令分派(设计文档 §5.4);`--dry-run` 分支**在调用任何 IO 之前**返回,
只打印"将会发的消息"与"将会用的 env"(测试用注入的 `deps` 断言零 `fetch` / 零 `spawn`)。

**TDD 步骤与断言点:**

- `test/run.test.js`(桩 `deps`):
  1. 无 `cookies.json` -> 零消息、零 `fetch`、退出码 0、状态里 `no-credentials` 进日志;
  2. 当天已成功过一次 -> 零消息、退出码 0;
  3. 正常:消息顺序 `[start, result]`,result 含 `投币:5 枚 · 投给关注的 UP · 余额`,状态 `lastResult:'success'`;
  4. 券已领:result 含 `B币券已领取 0 张`(或 `今日已领过`)且**不单发**消息(只有 start+result 两条);
  5. 普通会员:result 含 `会员券:普通会员 · 跳过 B币券`,不发 `action`;
  6. `nav.isLogin=false`:消息只有一条 `action`,退出码非 0;
  7. stdout 含 `-403` + `分享`:`result` 动作词 `运行有失败`、含缩进的原因行、**不推** `action`;
  8. 关注数为 0:`Ray_DailyTaskConfig__NumberOfCoins` 为 `'0'`,result 含 `投币:跳过 · 关注列表为空`;
  9. 余额 15(≤ 保留值 20):`target=0`,result 含 `投币:跳过 · 硬币余额不高于保留值 20`。
- `test/cli.test.js`:`--dry-run` 零 IO;`pause` / `resume` 改状态位;`cookies` 输出里**不含** `SESSDATA`。

### Task 5: Console 镜像(commit 5)

**产出:** `scripts/linux/bilibili/Dockerfile`、`scripts/linux/bilibili/deploy/run-once.sh`。
**本机没有 .NET SDK 或网络不通时:写出完整 Dockerfile 并标注"未实测",不许伪造构建成功。**

**Dockerfile(可粘贴草稿,按此实现):**

```dockerfile
# B站每日任务:上游 .NET Console(固定 commit)+ 本项目的 Node 薄壳
# 上游 RayWangQvQ/BiliBiliToolPro(GPL-3.0);自用,镜像不对外分发。
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG UPSTREAM_SHA=2db0fc613f
RUN sed -i "s|deb.debian.org|mirrors.cloud.tencent.com|g" /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL "https://codeload.github.com/RayWangQvQ/BiliBiliToolPro/tar.gz/${UPSTREAM_SHA}" \
      | tar xz --strip-components=1
RUN dotnet publish src/Ray.BiliBiliTool.Console/Ray.BiliBiliTool.Console.csproj -c Release -o /out

FROM mcr.microsoft.com/dotnet/runtime:10.0
ENV TZ=Asia/Shanghai \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    BILIBILI_CONSOLE_DIR=/app \
    BILIBILI_CONSOLE_DLL=/app/Ray.BiliBiliTool.Console.dll
# 零依赖项目不需要 npm,只要 node 可执行文件(同 Debian 系,glibc 兼容)
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=build /out /app
WORKDIR /app
COPY src /opt/bili/src
COPY deploy /opt/deploy
ENTRYPOINT ["/bin/bash", "/opt/deploy/run-once.sh"]
```

**`deploy/run-once.sh`(要点):**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/bili
# cookies.json 的进/出(设计文档 §12.3):Console 只在它的 cwd 认这个文件
[ -f /opt/bili/secrets/cookies.json ] && cp /opt/bili/secrets/cookies.json /app/cookies.json
echo "[run-once] $(date -Is) start"
node src/cli.js run; code=$?
if [ -f /app/cookies.json ]; then
    cmp -s /app/cookies.json /opt/bili/secrets/cookies.json || cp /app/cookies.json /opt/bili/secrets/cookies.json
fi
exit "$code"
```

构建命令(部署阶段用,本阶段**不执行**):
`cd /srv/apps/automation/bilibili && docker build -f Dockerfile -t automation-bilibili:local .`

### Task 6: 接入合集层(commit 6)

按设计文档 §11.5 的清单逐条落地(**全部只做加法**):

1. `config/schedule.json` + `config/schedule.example.json`:

```json
"bilibili-tasks": {
  "taskName": "BilibiliTasks",
  "startTime": "auto",
  "intervalMinutes": 120,
  "windowHours": 14,
  "maxAttemptsPerDay": 2,
  "logonDelayMinutes": "auto",
  "logonRetryMinutes": 10,
  "logonRetryWindowMinutes": 60,
  "runScript": "",
  "enabled": false,
  "actionVbs": "%BILIBILI_DIR%\\scripts\\windows\\run-daily.vbs"
}
```

   同时把 `bilibili-tasks` 追加到 `order` **末尾**,并在 `config/schedule.example.json` 的 `_readme` 里补一句
   "B站任务在扫码登录完成前保持 `enabled:false`"。

2. `scripts/linux/compose.yaml` 加 `bilibili-run`(设计文档 §12.2;照既有 service 的行文风格)。
3. `scripts/linux/run-all.sh`:加一行运行调用 + 一行 `note` + 末尾 `if` 的条件加 `&& [ "$RC_BILIBILI" -eq 0 ]`。
4. `scripts/linux/alert-fail.mjs`:`webhookFiles` 加 `'B站任务': '/srv/apps/automation/bilibili/secrets/wecom-webhook.txt'`。
5. `scripts/check-wecom-drift.mjs`:`FILES` 加 `'proj-bilibili-tasks/src/notify.js'`。
6. `scripts/setup-bilibili-tasks.sh`(照 `setup-epic-free-games.sh` 的形态):
   Node 版本 ≥20.11、目录存在、`npm test` 全绿、`node src/cli.js run --dry-run` 能跑、
   `secrets/cookies.json` 与 `secrets/wecom-webhook.txt` 是否就位(缺失只警告)。
7. `scripts/sync-bilibili-tasks.sh`(校验型,D5):1) 目录必要文件存在;2) `VENDOR_COMMIT.txt` 的 sha
   与 Dockerfile 里的 `ARG UPSTREAM_SHA` 一致;3) `check-wecom-drift.mjs` 通过;4) 不复制任何文件。
   顶部注释写明"将来若拆出独立工作区,照 `sync-weread-signin.sh` 升级为真同步"。
8. `proj-bilibili-tasks/scripts/windows/*` 见 Task 7。
9. 文档登记:`README.md` / `README.zh-CN.md` 项目表与目录树、`docs/automation-overview.md`、
   `docs/scheduling-convention.md` 第 1 节表、`docs/notification-convention.md` 消息类型表加一列、
   `docs/wecom-rules.md` 第 1 节实现表加一行、`docs/credentials.md` 加 B站段、
   `docs/workspace-model.md` 注明本项目是仓库内手写、`scripts/README.md` 登记两个新脚本、
   `scripts/local-paths.env.example` 加注释掉的 `BILIBILI_DIR`。
10. `proj-bilibili-tasks/{README.md,README.zh-CN.md,QUICKSTART.md}`:双语 README 顶部互链;
   QUICKSTART 必须含"扫码登录"的完整步骤与"窗口只有几分钟、慢了就重跑"的提醒。

### Task 7: Windows 侧运行器(commit 7)

**产出:** `proj-bilibili-tasks/scripts/windows/{run-daily.bat,run-daily.vbs,run-state.js,README-autostart.md}`。
照 `proj-epic-free-games/scripts/windows/` 的形态(**注意:那几个 .bat 里有 UTF-8 中文注释是已知缺陷,新写的不要照抄**):

- `run-daily.bat`:注释**只用 ASCII**;流程 = `run-state.js lock` -> 配额检查 -> 内存闸门 ->
  看门狗 -> `node src/cli.js run >> logs\last-run.log 2>&1` -> 退出码非 0 且日志无"[完成]"时调 `alert-fail` 的等价物;
  锁文件 `logs\run.lock`,内容 `{"pid","startedAt"}`。
- `run-daily.vbs`:隐藏窗口启动 bat(单行 `WScript.Shell.Run` 形态)。
- `run-state.js`:子命令 `lock|unlock|lock-status|quota|free-mem|kill|pids`;
  匹配进程用 `BILIBILI_RUN_MATCH`(默认匹配 `Ray.BiliBiliTool.Console` 与 `cli.js`)。
- `README-autostart.md`:说明这是**备用**入口,正规入口是 `node scripts/apply-schedule.mjs --apply --yes`。

### Task 8: 验证与分批提交(commit 8+)

**验证方式(确切命令,全部在本机离线跑):**

```bash
cd <本仓库>

# 1) 项目自带测试(离线;未 npm install 也要能跑)
cd proj-bilibili-tasks && npm test && cd ..

# 2) shell 与 JS 语法
bash -n scripts/linux/bilibili/run.sh scripts/linux/bilibili/deploy/run-once.sh \
        scripts/setup-bilibili-tasks.sh scripts/sync-bilibili-tasks.sh scripts/linux/run-all.sh
shellcheck scripts/linux/bilibili/run.sh scripts/linux/bilibili/deploy/run-once.sh \
           scripts/setup-bilibili-tasks.sh scripts/sync-bilibili-tasks.sh
node --check proj-bilibili-tasks/src/*.js proj-bilibili-tasks/scripts/windows/run-state.js

# 3) 漂移、隐私、调度(dry-run 只打印,不注册任何任务)
node scripts/check-wecom-drift.mjs
node scripts/check-privacy.mjs
node scripts/apply-schedule.mjs --dry-run     # 期望:4 行(3 注册 + B站 [跳过])

# 4) 干跑:不联网、不起子进程、不写状态
cd proj-bilibili-tasks && node src/cli.js run --dry-run && cd ..

# 5) 别把别的项目弄坏
cd proj-epic-free-games && npm test && cd ..
cd proj-weread-signin && npm test && cd ..

# 6) 行数上限
find proj-bilibili-tasks/src proj-bilibili-tasks/scripts -name '*.js' |
  xargs wc -l | awk '$1 > 200 && $2 != "total" {print "超行数:", $0}'
```

**分批提交(每批一行中文 conventional commit,显式路径):**

| 批次 | 内容 | 提交信息 |
| --- | --- | --- |
| 1 | Task 1 骨架与许可 | `feat(bilibili): 加 B站任务项目骨架与许可声明` |
| 2 | Task 2 纯函数层与测试 | `feat(bilibili): 加 B站任务的纯函数层与离线测试` |
| 3 | Task 3 IO 层与测试 | `feat(bilibili): 加 B站任务的接口与子进程封装` |
| 4 | Task 4 编排与 CLI | `feat(bilibili): 加 B站任务的运行编排与命令行` |
| 5 | Task 5 镜像与容器骨架 | `feat(bilibili): 加 B站任务的 Console 镜像与容器入口` |
| 6 | Task 6 合集层接入 | `chore(bilibili): 把 B站任务接入套件调度与通知` |
| 7 | Task 7 Windows 运行器 | `feat(bilibili): 加 B站任务的 Windows 侧运行器` |
| 8 | Task 8 文档与收尾 | `docs(bilibili): 补 B站任务的使用说明与索引` |

提交前:`git status` 确认无 `data/` / `secrets/` / `node_modules/` 混入;`git grep` 复查真实 mid、`SESSDATA`、
webhook `key=`、本机用户目录路径、盘符绝对路径。

---

## 部署与回滚(本阶段只写下来,不执行)

### 部署顺序(由简报 C 的阶段执行)

1. **预检**(在服务器上):`docker pull mcr.microsoft.com/dotnet/runtime:10.0`、
   `curl -I https://codeload.github.com`、`node -v`、磁盘余量。
2. **传代码**:仓库 clone/pull 到服务器 -> 组装 `/srv/apps/automation/bilibili/{src,deploy,Dockerfile}`,
   建 `data/` `logs/` `secrets/`(属主给登录用户)。
3. **放凭据**:`secrets/wecom-webhook.txt`(新群机器人的 key,权限 600)。
4. **构建镜像**:`cd /srv/apps/automation/bilibili && docker build -f Dockerfile -t automation-bilibili:local .`
5. **扫码登录**(唯一必须用户本人做的步骤,见下)。
6. **保持 `enabled:false`** 干跑:先 `node src/cli.js run --dry-run`,再
   `docker compose -f compose.yaml run --rm -T bilibili-run`(此时 cookies.json 已在)。
7. **启用**:确认干跑结果正常后,再把 `config/schedule.json` 的 `enabled` 改 true 并在 Windows 侧
   `node scripts/apply-schedule.mjs --apply --yes`(若也要在本机跑)。Linux 侧不需要开 —— `run-all.sh`
   不看 `enabled`,它每次都调,程序自己用守卫与 `no-credentials` 早退。

### 回滚(不删别人的东西)

1. `scripts/linux/run-all.sh` 里删掉那行运行调用与条件里的一节;
2. `scripts/linux/compose.yaml` 删掉 `bilibili-run` service;
3. `config/schedule.json` 的 `enabled` 改回 false(或整条删掉)并重跑 `--apply`;
4. 容器与镜像:`docker compose ... rm -f bilibili-run`、`docker rmi automation-bilibili:local`;
   `data/` 与 `secrets/` 留在宿主机(下次恢复不用重新扫码)。

### 必须用户本人操作的步骤(只有这一条)

**在服务器上扫码登录一次。** 确切命令与看点:

```bash
cd /srv/apps/automation
docker compose -f /srv/apps/automation/compose.yaml run --rm -T bilibili-run login
```

- 控制台会先打印二维码的半角块字符,随后打印一个 `https://tool.lu/qrcode/basic.html?text=...` 链接;
  用手机 B站 App 扫那个链接里的二维码(块字符在服务器终端里往往看不清)。
- **上游轮询 10 次,每次之间约 20 秒 = 窗口约 3 分钟**(2026-10-11 服务器实测;原文写的 50 秒是错的),
  超时会报"登录超时"。慢慢扫也行,超时就重跑上面的命令。
- 成功后看 `/srv/apps/automation/bilibili/secrets/cookies.json` 是否存在、里面是否出现 `DedeUserID`;
  再用 `node src/cli.js check`(或容器内等价命令)看 `会员类型 / 硬币余额 / 券状态` 三行是否正常。
- 出了 `扫码登录` 之外的任何事(镜像起不来、接口 4xx)都由实现者排查,不需要用户动手。

---

## 风险与对策

| 风险 | 对策 |
| --- | --- |
| 上游 main 活跃,行号与行为会漂 | 固定 commit `2db0fc613f`;`VENDOR_COMMIT.txt` + Dockerfile `ARG` 两处锁;`sync-bilibili-tasks.sh` 校验一致;实现前按该 commit 复核"`Daily` 内嵌领券是否受 `VipPrivilegeConfig:IsEnable=false` 控制"(`未验证`) |
| 第 4 份 `wecom-core` 漂移 | 整段逐字节复制;块内老注释原样保留,纠正说明写块外;`check-wecom-drift.mjs` 纳入第 4 份(纯加法) |
| 给陌生人投币 | 运行前查关注数,0 或未知就把 `NumberOfCoins` 置 0;`SupportUpIds` 保持空;残余风险(关注数≥1 但上游取关注列表失败)已写进设计文档 §8.2 |
| 账号级风控 `-403` | 不绕、不重试、不改设备指纹;只记进 result 的失败行;不推 `action` |
| 登录窗口只有几分钟 | 检测到链接立刻推 `action`;QUICKSTART 写明"超时就重跑";实测 10 轮 × 约 20 秒 |
| `cookies.json` 落点由 Console 的 cwd 决定 | `console-runner.js` 显式给 `cwd = config.consoleDir` 并写进测试;`run-once.sh` 复制进/出,不用单文件 bind mount |
| 上游 13 个通知 sink 被误开 | `console-runner.js` 的 D15 前置断言(env 里有非空 `Serilog__WriteTo*` 直接拒绝),有单测 |
| 云主机拉不到 mcr / GitHub | 部署预检先探;不通则走 vendor 源码或本机交叉 publish 自包含产物的备选(设计文档 §12.5) |
| `mem_limit` 给少了被 OOM 杀 | 先给 1200m,部署后按实测调(未验证项) |
| 与另一会话并行改 `scripts/linux/` | 只做加法;发现既有行被改动或冲突 -> 停下报告,不硬改 |

---

## 未做 / 明确不做(本阶段)

- **不写产品代码**、不动仓库、不连服务器、不构建镜像(本阶段只产出设计与计划两份文档)。
- 不做美团(设计文档 §2.2 已给理由)。
- 不做多账号规模化封装;`accounts` 参数在第一版里按"1 个账号"设计,多账号只做到"`cookies.json` 里有几条就依次处理"
  (单账号跑不通就先不做)。
- 不做 `Daily` 之外的直播/粉丝牌/抽奖类任务。
- 不实现"扫码登录的自动化"(必须人工扫)。
- 不改上游任何代码;不把上游源码 vendor 进公开仓库(除非构建期网络不可用,那时再单独决定)。
