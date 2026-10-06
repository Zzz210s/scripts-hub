# Epic 周免自动领取:验证码与出口 IP 问题可选路线调研

日期:2026-10-06
范围:只读调研(克隆/读源码、读 issue/discussion、读官方计费页),未改动任何现有代码,未登录任何账号,未打印凭据。
一手来源:各仓库源码、GitHub API、官方计费页。本仓库现有调研(不重复):
`docs/epic-api-claim-research.md`(纯 API 领取可行性)、`docs/sonkwo-research.md`(杉果代领)。

---

## 0. 一句话结论

**推荐「住宅 IP + 本地可见浏览器」为默认路线(即本仓库 `proj-epic-free-games` 的设计目标),
把「模型解 hCaptcha + 付费代理池换出口」当作服务器无人值守的备选,不建议为了继续在腾讯云机房无人值守
而专门搭一套「模型打码 + WARP」。**

两条关键事实支撑这个判断:

1. **纯 API 已不可行,验证码只能靠「真实浏览器被动通过」或「模型主动解」**(本仓库
   `docs/epic-api-claim-research.md` §0/§3.1 已论证:Talon 下发的 `captchaToken` 只能在真实浏览器里
   被动生成或用打码服务换取)。
2. **触发 hCaptcha 的主因不只是 IP,还有「无头/虚拟机指纹」**;而机房 IP 会额外加重挑战。住宅 IP 只有在
   同时用「看起来像真人的浏览器」时才有收益(见 §6)。

成本量级:模型路线本身很便宜 —— 主力模型 Gemini 3.5 Flash Lite 有免费额度,付费价 **$0.30/百万输入、
$2.50/百万输出**(出处:Google 官方计费页,2026-10-06 读)。**真正贵且不可控的是出口 IP**:开源项目里
WARP(Cloudflare 免费出口)已被弃用,现役项目改用付费机场代理池(见 §2、§3)。

---

## 1. 现状与问题定义

- 本机领取引擎:本仓库 `proj-epic-free-games/vendor/free-games-claimer/`(逐字节收编
  `vogler/free-games-claimer` dev 分支,commit `f282d3cca93b4b7ff68fa6b647cf0f11520b4273`,2026-09-02;
  见 `proj-epic-free-games/VENDOR_COMMIT.txt`)。
- 报错原文出处:该引擎 `epic-games.js:345` 打印
  `Failed to claim! To avoid captchas try to get a new IP address.`
  —— 这是**引擎自己的兜底提示**,不是 Epic 的服务端文案;它出现的上下文是被 hCaptcha 挡住结账
  (`epic-games.js:318-345`,旧注释提到 NopeCHA 扩展,现已注释掉)。
- 另一处同类提示:`epic-games.js:319`
  `Got hcaptcha challenge! Lost trust due to too many login attempts? ... get a new IP address.`
- 登录阶段的挑战:`epic-games.js:121`
  `Got a captcha during login (likely due to too many attempts)!`

也就是说:**这条报错本身就是「机房 IP 撞反欺诈」的典型表现**,换入口(住宅 IP)或换打法(模型解)都可能消除它。

---

## 2. 方案对比表

| 方案 | 原理 | 成本 | 成功率证据 | 失效风险 | 最后活跃 |
|---|---|---|---|---|---|
| **A. 住宅 IP + 本地可见浏览器**(推荐) | 在家宽 IP 上用非无头浏览器登录;hCaptcha 常被动通过(checkbox),不用解 | 0(本机已有) | `proj-epic-free-games/README.md`「引擎故意强制可见浏览器」;vogler README(§5)「stealth 那套规避足以不再弹 hCaptcha,非无头模式领取成功」 | 若浏览器被识别为 VM/无头,住宅 IP 也救不了(§6) | 引擎 2026-09-02;本项目持续 |
| **B. 模型解 hCaptcha + 代理池换出口**(`10000ge10000/epic-kiosk` 式) | Playwright + `hcaptcha-challenger` 用多模态大模型识图点选;多出口代理按账号稳定分配,出口被风控则换 | 模型费很低(Gemini 免费额度/付费 $0.30+$2.50 每百万 token);**出口池要钱**(已从免费 WARP 换成付费机场代理) | 公益站点 `https://epic.910501.xyz/` 实测 HTTP 200 / `/health/ready` 返回 `{"status":"ready"}`(2026-10-06 本机 curl) | 依赖上游 `hcaptcha-challenger` 与模型能力;出口代理质量决定成败 | 2026-09-18(`gh api` pushed_at) |
| **C. 模型解 hCaptcha + GitHub Actions**(`Ronchy2000/epic-freebies-helper` 式) | 同上,但跑在 GH Actions(Azure 机房 IP),用 GLM-4.6V 解图 | GLM 有免费额度但会变(见 §4);GH Actions 免费 | discussions #3 有 2026-04~07 多条成功留言(见 §4) | 作者文档自认:共享云 IP 会让验证码更难(§6);`BROWSER_PROXY` 是可选补丁 | 2026-09-06 |
| **D. 纯 API 领取** | 直接把 token 打到 `orderprocessor`/`confirm-order` | — | — | **已判不可行**(周免 BASE_GAME 结构性拒绝) | — |
| **E. 维持现状**(服务器 + 退化到通知链接) | 领取走机器人;**拿不到就直接推预置结账链接让人点一下** | 0 | `proj-epic-free-games/README.md` 已实现该退化路径 | 需要人每周点一次;不满足无人值守 | 本项目持续 |

---

## 3. 关键实现细节(带出处)

### 3.1 `10000ge10000/epic-kiosk` —— 模型链 + 多出口

**它怎么解验证码**

- 用第三方开源库 `hcaptcha-challenger` 的 `AgentV` 驱动多模态大模型识图:
  `app/services/captcha/solver.py:1-56`(`HCaptchaChallengerSolver` 包一层 `agent.wait_for_challenge()`,
  按 `ChallengeSignal` 分 SUCCESS/RETRY/TIMEOUT/FAILED)。
- **「三模型链」= Google 主力 + SiliconFlow 两级兜底**,调 **OpenAI 兼容接口**
  `POST {base}/v1/chat/completions`(出处:`app/provider_router.py:83-104`):
  1. 主力:`CAPTCHA_PRIMARY_MODEL=gemini-3.5-flash-lite`,base `https://generativelanguage.googleapis.com/v1beta/openai/v1`
  2. 兜底:`CAPTCHA_SECONDARY_MODEL=zai-org/GLM-4.5V`,base `https://api.siliconflow.cn/v1`
  3. 再兜底:`CAPTCHA_TERTIARY_MODEL=moonshotai/Kimi-K2.7-Code`,同上 SiliconFlow
  出处:`.env.example`(SiliconFlow/Google 段)、`README.md:109-124`、`docker-compose.yml`(worker 的
  `CAPTCHA_PRIMARY/SECONDARY/TERTIARY_*` 变量)。
- 熔断与降级在 `app/provider_router.py:29-182`:连续失败 3 次熔断 600s;401/403 快速失败(三级共用同一把
  SiliconFlow key,换级重试无意义);`CAPTCHA_TOTAL_API_BUDGET=150` 秒总预算。
- 另有可选的付费打码兜底 `TwoCaptchaTokenSolver`(默认关闭,`CAPTCHA_PROVIDER=none`),
  `solver.py:76-180`;配套 sitekey `CAPTCHA_PROVIDER_SITE_KEY=91e4137f-95af-4bc9-97af-cdcedce21c8c`
  (`.env.example`)。注意本仓库 `epic-api-claim-research.md` §3.1 指出该 sitekey 由 Talon 动态下发,硬编码可能失效。

**它怎么换出口**

- 架构已从「自建 WARP 容器」切到「**商业机场代理池**」;2026-09-18 提交信息原文:
  「接入机场代理池与毫秒级选优避让,**下线 WARP 容器**并在仓库中忽略 tests 目录」(`gh api` commits)。
- 当前 `docker-compose.yml`(worker):`WARP_PROXY_HOST=zen-airport-proxy`、`WARP_PROXY_COUNT=27`、
  `WARP_PROXY_START_PORT=19025`、`WARP_EXPECT_WARP=false`、`HTTP_PROXY=http://zen-airport-proxy:19025`,
  并连外部网络 `zen-proxy`。即:**README 里「单容器 10 个 WARP 实例」是旧文档,现存活的是 27 端口机场代理池。**
- 按账号稳定选出口 + 出口被风控自动避让:`worker.py:297-327`(`get_warp_index_for_email` 用邮箱哈希取模)、
  `worker.py:432-500`(`mark_exit_ip_blocked`/`ensure_warp_ready`:命中 Epic 风控黑名单的出口 IP 加入
  Redis 黑名单 TTL=1800s 并顺延端口;整池误杀时自愈清空)。
- 结账被 Cloudflare/Talon 拦截时中断并触发节点轮换:`app/services/epic_games_service.py:1526`、`:1547`、
  `:1825`。

**是否需要多账号 / 密码**:是。Web 控制台提交 Epic **邮箱 + 密码**,凭据用 Fernet 加密落库
(`README.md:173-178`、`app/secure_store.py`、`app/services/epic_authorization_service.py`),
支持多账号托管与排队(`README.md:20-25`)。

**最后活跃 / 是否可用**:`pushed_at=2026-09-18`;仓库未归档;公开公益站点仍在跑(§2 表)。可用。

### 3.2 `Ronchy2000/epic-freebies-helper` —— GLM 多模态 + GH Actions

**GLM 调用方式(模型名 / prompt / 成本)**

- 模型:`GLM_MODEL=glm-4.6v`,base `https://open.bigmodel.cn/api/paas/v4`(智谱),通过
  `app/extensions/llm_adapter.py` 把 Google GenAI SDK **猴子补丁成 OpenAI Chat Completions**,
  实际 `POST {base}/chat/completions`(`_GLMAsyncModels.generate_content`)。
- 视觉任务的 prompt 是**内置长指令**(不是一句白话):`GLM_VISUAL_COORDINATE_INSTRUCTION`(读图上灰色坐标网格
  而非像素)、`GLM_COMPLEX_DRAG_INSTRUCTION`(拖拽题:逐块匹配形状/颜色/朝向,线段题按编号 3/5 之间补第 4 段)、
  `GLM_MULTI_TARGET_INSTRUCTION`(动物计数题:先找参考条,只点可点击网格)—— 见 `llm_adapter.py:63-104`。
- 视觉请求用 `response_format={"type":"json_object"}` 要结构化输出;`glm-4.5`(前缀)会带 `thinking` 开关
  (`_glm_thinking_payload`)。返回还要过约 550 行「归一化」把各种别名(`source/target/answer/coordinates`)
  掰成上游 schema。
- 除模型外,仓库还写了**本地 CV 确定性求解器**(可能更省 token):
  `app/extensions/numbered_line_solver.py`、`hcaptcha_adapter.py` 里的轮廓拓扑匹配/颜色标记/网格检测。
- 成本 / 免费额度:`README.md`(GLM 段)记录「首次实名认证赠送三个月 glm-v4.7 资源包」;
  discussions #3 有人反馈 2026-07-14「现在拉不到 GLM-4.6V 模型了,貌似不免费了」,2026-07-24「实名后送了
  token 就正常了」。

**GitHub Actions 怎么跑**

- `.github/workflows/epic-gamer.yml`:cron `20 15 * * 4`(周四 UTC 15:20),`runs-on: ubuntu-latest`,
  `xvfb-run` 提供虚拟显示,`HEADLESS=virtual`,`BROWSER_BACKEND=auto`(Camoufox 优先,失败退 Playwright Firefox),
  `BROWSER_PROXY` 从 secret 传入(可选)。默认**不在主仓执行定时任务**,要求用户 fork
  后才跑(`if: github.repository != 'Ronchy2000/epic-freebies-helper'`)。
- 需要账号密码:`EPIC_EMAIL`/`EPIC_PASSWORD`(或 `EPIC_ACCOUNTS`)放 GH Secrets;支持 `EPIC_TOTP_SECRET`
  传 2FA(`epic-gamer.yml` env;`README.md` 常见问题段)。

**最后活跃**:`pushed_at=2026-09-06`;4 个 open issue;讨论活跃到 2026-10-04。可用但依赖 GLM 额度。

### 3.3 其它现役(2026 仍提交)

- `Magerko/Epic-Claimer`(2026-06-14,pushed):Camoufox/Playwright + `hcaptcha-challenger` + Google Gemini
  (`gemini-2.5-flash` 免费 / `gemini-2.5-pro` 付费),Docker,多账号各带 `proxy`。README 明确警告:
  **「便宜的数据中心代理常已被 Epic/hCaptcha 拉黑,只会让验证码更难;这个场景适用住宅/移动代理。」**
- `Autsunset/epic-free`(2026-07-31):`epic-freebies-helper` 的重构版,统一 openai/anthropic/gemini provider,
  无独立出口方案说明。
- `QIN2DIM/epic-awesome-gamer`(2025-11-07,1130 star):`hcaptcha-challenger` 作者的原始 Epic 工具,
  内置 AI 模块 + Gemini,是 kiosk / helper 的共同上游思路;已半年多未更新。
- `KingHacker9000/Claim-Free-Games`(2026-09-04):API-first(orderprocessor quickPurchase)+ Patchright 浏览器兜底,
  遇 `quickPurchaseStatus==CHECKOUT` 升级浏览器(本仓库 `epic-api-claim-research.md` §3.3 有引)。
- `spin311/epic-free-games-claim`(2026-10-02,82 star):**浏览器扩展**,在用户自己浏览器里点领取 —— 天然住宅 IP、
  不无人值守。
- `P-Adamiec/Free-Games-Claimer-Remaster`(2026-10-04,400 star):vogler 系的 Python 重写,checkout 里的
  hCaptcha 交人(需 VNC)解。

> 未能核实的:`Daryl-M/epic-freebies-bot`(2026-10-02,无描述、0 star)未读源码,不做判断。

---

## 4. 失效史与证据(原文关键句)

**「机房/共享云 IP 让验证码更难」——两个现役项目自己写下的**

- `epic-freebies-helper` `docs/hcaptcha-reliability-plan.md:196-198`(原文):
  「在 GitHub Actions 上跑意味着用 **Azure 数据中心 IP** 撞 Epic/hCaptcha 风控。」
  「同一道题,**住宅 IP 可能直接 pass 走 checkbox,数据中心 IP 则会被反复升级难度**。
  这是验证码难度偏高的结构性来源。」
- `epic-freebies-helper` `README.md:330`(原文):「GitHub Actions 环境采用**公共 IP**,易触发 Epic
  严格风控,导致验证码成功率波动,属预期内现象。」
- `epic-freebies-helper` `.github/workflows/README.md:197`(原文):「GitHub Hosted Runner 的共享出口 IP
  仍可能**提高挑战难度**。」
- `Magerko/Epic-Claimer` README(原文,俄语):「**Дешёвые датацентровые прокси часто уже в чёрных списках
  Epic/hCaptcha** и могут только усложнить капчу. Для этой задачи подходят резидентные/мобильные.」
- 本仓库 `docs/epic-api-claim-research.md` §3.1/§3.2:「toutes les IPs cloud sont flaguées par Cloudflare en 2026」
  (Azure/AWS/Oracle/GCP/Hetzner/OVH);GH Actions 实测截图报「Vérifiez que vous êtes un humain」。

**「模型答错」不是主因 —— 解析/工程缺陷才是(helper 自证)**

- `docs/hcaptcha-reliability-plan.md:9-13`(原文):当前失败**主要不是「模型不够聪明」**;
  实测 0 次「Failed to challenge」、0 次超时,失败几乎全发生在「把 LLM 回答解析成上游 schema」这一步。
- 同文 §二 记录了 P0 缺陷:别名表把上游合法的 `image_drag_multi` 改成不存在的 `image_drag_multiple`,
  导致「纯文本兜底路径」整类拖拽题 100% 失败 —— 根因是 `pyproject.toml` 对 `hcaptcha-challenger`
  用开放上界 `>=0.18.13`,上游从 0.18 漂到 0.19 改了枚举名。
- 同文 §九(2026-08-14,基于 Actions run `31766718025`):GLM 视觉请求 50s 超时后上游三次重试 → 单步约 156s,
  超过 hCaptcha 单轮 120s 时限;且**关闭 GLM thinking 虽把响应降到 7-11s,却会返回整网格坐标、准确率显著下降**。

**模型免费额度的漂移(会影响「免费」假设)**

- `epic-freebies-helper` discussions #3:2026-07-14「现在拉不到 GLM-4.6V 模型了,貌似不免费了」;
  2026-07-24「实名后送了 token 就正常了」。
- 2026-09-26 仍有 open issue #30:同配置 `glm-4.6v` 下 `Problem type: Captcha failed`(fork 用户)。

**「换上游 sitekey/名字」确有先例**:helper 的 P0 就是上游枚举改名导致的连锁失败(上文);
本仓库 `epic-api-claim-research.md` §3.1 指出 checkout sitekey 由 Talon 动态下发,不宜硬编码。

**成功证据(而非宣传语)**

- helper discussions #3「成功领取的来这里留言」15 条,示例原文:
  2026-04-27「我成功了」;2026-05-02「成功咯,**第一次失败了重新跑了一次就成功了**」;
  2026-05-22「我成功运行了,但是是在遇到领取错误,**手动领取之后**才成功的」。
- kiosk 公益站点 2026-10-06 实测 `HTTP 200`,`/health/ready` → `{"status":"ready"}`。

---

## 5. 成本核算(按每周一次领取)

**模型调用(每周)**

- 一次「冷登录」的验证码通常要数次到十几次数图请求(helper 实测一次登录流程含多次重试,见 §4)。
  以 Gemini 3.5 Flash Lite 计:**免费额度内为 0**;超出后 **$0.30 / 百万输入 token、$2.50 / 百万输出 token**
  (官方计费页,2026-10-06 读)。
- 粗估量级:单次登录 ~10 次视觉调用 × 每次约 1-3k token ≈ 2 万输入 + 数千输出 →
  **付费也不过约 1 分钱人民币/周**。付费更贵的 Gemini 3.8 Flash 为 $0.75/$3.75(同上)。
- GLM-4.6V / SiliconFlow 具体单价:**未从官方页取到可信实时数字(页面为 JS 渲染)**,以智谱/SiliconFlow
  控制台为准;历史事实是有免费额度、会变动(§4)。
- 结论:**模型费不是成本瓶颈**。

**出口 IP**

- **WARP(Cloudflare)免费,但出口是 Cloudflare 自己的机房段,已被大量标记** —— kiosk 直接**下线了 WARP 容器**
  改用付费机场代理(§3.1)。机场代理价格未在仓库中给出;这是方案 B 的真实持续成本。

**服务器资源**

- kiosk worker 容器限额:`mem_limit: 4g`、`cpus: "2.00"`、`pids_limit: 800`、`shm_size: 512m`
  (`docker-compose.yml`),另有 redis 256m、web 512m。即**一台 4G 内存起的机器**足够跑单账号;
  多账号是串行 + 分批(kiosk 默认每批 5 账号、批间隔 600s)。

---

## 6. 与「住宅 IP」路线的对比

**「把领取挪到家里宽带 IP,是否就不用解验证码?」——多数情况是,但有前提。**

支持「住宅 IP 直接过」的证据:

- `vogler/free-games-claimer` README(dev 分支同一引擎)原文:「**Without stealth plugin, the website shows
  an hcaptcha on login ... After <6h it resets to no captcha again. Getting a new IP also resets.**」——
  即**验证码是「可疑度」驱动的,换新 IP 会重置回「无验证码」状态**。
- 同 README:「The listed evasions are enough to **not show an hcaptcha**. Script claimed game successfully
  in **non-headless** mode.」「epic games: **headless mode gets hcaptcha challenge**.」
- helper `docs/hcaptcha-reliability-plan.md:198`:「同一道题,**住宅 IP 可能直接 pass 走 checkbox**」。

**反例/前提(别把住宅 IP 当万能):**

- 本仓库 `docs/epic-api-claim-research.md` §3.1 引 `AUTO_CLAIM_FINDINGS.md` 实测:**同一账号在
  Chrome/Windows 住宅线上验证码是被动通过;在 Oracle VM(Xvfb) 每次都弹图片挑战;换住宅 IP、换指纹、
  换 Chrome 全无效** —— 说明**「虚拟机/无头指纹」本身就是独立触发因素**,机房 VM 里单独换住宅 IP 未必够。
- 用户引用报错的引擎(local vendored `epic-games.js:46`)直接写死
  `headless: false, // don't use cfg.headless headless here since SHOW=0 will lead to captcha` ——
  引擎作者认定**无头 = 触发验证码**,所以强制可见浏览器。
- helper 自己的 P2 结论:代码加了 `BROWSER_PROXY`,但「代理**只能改变网络出口,不能保证绕过风控**」
  (`.github/workflows/README.md:197`、`README.md:138`)。

**合起来看:** 住宅 IP 的收益是**降低触发概率**,但必须搭配「非无头、非 VM 特征、干净会话」。
这就是为什么本仓库 `proj-epic-free-games` 把领取放在**本机可见桌面**、并把 hCaptcha 当退化路径而非 bug。

---

## 7. 结论与最小验证方案

**推荐路线(按性价比):**

1. **首选 A(住宅 IP + 本地可见浏览器)** —— 就是本仓库 `proj-epic-free-games` 的设计目标
   (本机 Windows、可见浏览器、WeCom 通知、失败退化到预置结账链接)。零模型费、零代理费。
2. **备选 B(服务器无人值守)** —— 若有必须云端/多账号的刚需,照 `epic-kiosk` 的成熟形态做:
   `hcaptcha-challenger` + 模型链(Gemini 主力 / GLM+Kimi 兜底)+ **付费代理池**(不要用 WARP),
   并接受「上游库/模型/出口任一处变化都可能失效」。模型费可忽略,主要成本是代理与维护。
3. **不建议 D(纯 API)** —— 已在 `docs/epic-api-claim-research.md` 判不可行。
4. **维持现状(服务器机房 IP)** 只在「退化到通知人工点链接」的意义下可用(方案 E)。

**最小验证方案(花最小代价证伪/证实,不动现有代码):**

1. **先验住宅 IP 是否免验证码**:在本机(住宅宽带的 Windows)用已有的 vendored 引擎跑一次单账号领取
   (`proj-epic-free-games` 的 `run` 子命令 / `vendor/free-games-claimer` 的 `node epic-games.js`),
   观察日志里是否出现 `epic-games.js:121` 的登录验证码与 `:319` 的结账验证码。若都不出现 → 路线 A 成立,
   无需任何模型/代理。
2. **若仍出现验证码**:用 `hcaptcha-challenger` 的官方 CLI 在本机对 Epic 站点做一次独立解图演练
   (只读,不改变服务状态),确认「模型 + 该站点题型」能否解通,再决定是否值得接模型链。
3. **对比出口假设**:在**同一浏览器指纹**下,分别从本机住宅 IP 与服务器机房 IP 访问结账页,对比是否弹挑战
   —— 以区分「IP 因素」与「指纹/VM 因素」。
4. **退化路径兜底验证**:确认 `proj-epic-free-games` 的「预置结账链接 + WeCom 通知」在领取失败时确实能送达
   (这是无论走哪条路都要保留的安全网)。

---

## 8. 未解问题

- **GLM-4.6V / SiliconFlow 的实时单价未取到可信数字**(智谱与 SiliconFlow 计费页为 JS 渲染,curl 拿不到表格);
  另 GLM 免费额度是否还在,需登录控制台确认。
- **kiosk 用的「机场代理池」具体是哪个服务、月费多少、住宅/机房占比**:仓库只暴露
  `zen-airport-proxy` / `zen-proxy` 外部网络名,价格与线路类型未公开,无法核算方案 B 的真实持续成本。
- **helper 的 `BROWSER_PROXY` 到底有没有人成功配过、成功率提升多少**:README 只说「可选」,
  未找到带代理的实测成功报告。
- **Epic checkout 的 Talon sitekey 是否真动态**:kiosk 仍硬编码
  `91e4137f-95af-4bc9-97af-cdcedce21c8c`,与本仓库调研「动态下发」的说法矛盾,未实测。
- **住宅 IP 单独(不动浏览器指纹)能否解掉机房 VM 的挑战**:`AUTO_CLAIM_FINDINGS` 说是「换住宅 IP 无效」,
  但那是在同一 Oracle VM 上;本机真实桌面未做同条件对照。
- **上游 `hcaptcha-challenger` 的长期可维护性**:helper 的 0.18→0.19 枚举改名事故说明该库接口不稳定,
  kiosk 明确用「宽带解耦」补救(超时预算 + 多 provider),但两者都强耦合上游。

---

## 附:主要出处清单

仓库源码(本次克隆 `/c/tmp/epic-repos/`):
- `10000ge10000/epic-kiosk`:`app/services/captcha/solver.py`、`app/provider_router.py`、`app/settings.py`、
  `.env.example`、`docker-compose.yml`、`worker.py`、`app/services/epic_games_service.py`、`README.md`、
  `docs/MODEL_CONFIG.md`(pushed_at 2026-09-18)
- `Ronchy2000/epic-freebies-helper`:`app/settings.py`、`app/extensions/llm_adapter.py`、
  `app/extensions/hcaptcha_adapter.py`、`app/services/browser_context.py`、`.github/workflows/epic-gamer.yml`、
  `docs/hcaptcha-reliability-plan.md`、`README.md`、`docs/advanced.md`(pushed_at 2026-09-06)

本地(本仓库):
- `proj-epic-free-games/vendor/free-games-claimer/epic-games.js`(行 46/121/319/345)、`VENDOR_COMMIT.txt`、
  `proj-epic-free-games/README.md`
- `docs/epic-api-claim-research.md`(§3.1 Talon/captchaToken、§3.2 Cloudflare 拦机房 IP、§3.3 结构性拒绝、§4 项目对比表)

GitHub API / 网页(2026-10-06 读):
- `vogler/free-games-claimer` README 与 issue #183、issue #2
- `Magerko/Epic-Claimer` README
- `QIN2DIM/hcaptcha-challenger`(pushed_at 2026-08-15)
- `Ronchy2000/epic-freebies-helper` discussions #3、issue #30
- `epic.910501.xyz/health/ready`(HTTP 200,`{"status":"ready"}`)

官方计费页(2026-10-06 读):
- `https://ai.google.dev/gemini-api/docs/pricing`(gemini-3.5-flash-lite:$0.30 输入 / $2.50 输出 每百万 token,
  有免费额度;gemini-3.8-flash:$0.75 / $3.75)
