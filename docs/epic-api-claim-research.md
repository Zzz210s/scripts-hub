# Epic 周免游戏「纯 API 领取」可行性调研

日期:2026-10-06
范围:只读调研,未改动任何现有代码;未使用真实 token 做写操作。
一手来源:直接读仓库源码 + 官方文档 + 本机实测(见各条「出处」)。

---

## 0. 一句话结论

**不可行(对周免 BASE_GAME)。** Epic 对「周免基础游戏」的领取在服务端强制走 web checkout 流程:
最终 `confirm-order` 需要一个由 **hCaptcha Enterprise(经 Talon 反欺诈服务)** 签发的 `captchaToken`,
这个 token 只能在真实浏览器里被动生成或用付费打码服务换取。两个纯 HTTP 的 `quickPurchase` 端点
对周免 BASE_GAME 都拒绝:`orderprocessor` 返回 `quickPurchaseStatus: CHECKOUT`(要求转 web 流程),
`egs-platform-service` 返回 `HTTP 400 Offer is not eligible`。只有 F2P / DLC 一类**非周免**商品能纯 API 领取成功。

**推荐路线**:保留现有浏览器引擎(它本来就能走到 checkout 最后一步),把「云端机房 IP 被 Cloudflare 拦」
这件事从**领取**环节挪开 —— 即在本机/住宅 IP 上跑领取,或在退化路径上发预置结账链接让人点一下。
不建议投入「纯 API 领取」,除非愿意接付费 hCaptcha 服务并接受随时失效。

出处(汇总,详见后文):
- `Jonathan8520/epic-free-games-discord` `AUTO_CLAIM_FINDINGS.md`(2026-05-31 HAR 实测,2026-10-01 归档结论)
- `KingHacker9000/Claim-Free-Games` `src/epic-api.ts` / `src/claimer.ts`(2026-09,现役 API-first 实现)
- 本机 2026-10-06 curl 实测(见第 3、6 节)

---

## 1. 结论(可行性判断 + 推荐路线)

| 领取对象 | 纯 API 可行性 | 依据 |
| --- | --- | --- |
| 周免 BASE_GAME(每周免费游戏) | **不可行** | Jonathan `AUTO_CLAIM_FINDINGS.md` 实测表;`claimer.py`;`KingHacker9000/src/claimer.ts` 遇 `CHECKOUT` 必转浏览器 |
| F2P / DLC / 非周免 0 元商品 | 可行(不保证长期) | Jonathan `claimer.py`(2026-05-17 验证 `quickPurchaseStatus: SUCCESS`) |
| 领取成功回执 | API 可查 | entitlement API(见第 1.3、6 节) |

**关键区分**:`quickPurchase` 不是「领取 API」,而是 launcher 的快速下单入口。周免基础游戏被 Epic
结构性地排除在快速下单之外 —— 这正是各项目「能发现、能校验、但无法纯 API 领取」的原因。

出处:`Jonathan8520/.../AUTO_CLAIM_FINDINGS.md`「L'API backend pure NE marche PAS pour les BASE_GAME hebdo」段;
`KingHacker9000/Claim-Free-Games/src/claimer.ts` 第 39-42 行(`quickPurchaseStatus === 'CHECKOUT'` → 升级到浏览器兜底)。

### 推荐路线(按性价比排序)

1. **保守(推荐)**:继续用现有浏览器引擎在本机/住宅 IP 跑;若被 hCaptcha 挡住,退化为推送预置结账链接。
   与现有设计一致 —— 本地 `PLAN.md:236`、`README.md:32,203` 已把 hCaptcha 当作退化路径而非 bug。
2. **云端领取 + 住宅出口**:若一定要在服务器无人值守,领取环节走住宅代理/隧道出口,避免 Cloudflare
   对机房 IP 的挑战(`AUTO_CLAIM_FINDINGS.md` 明确 `store.epicgames.com` Cloudflare 拦 Azure/AWS/Oracle/GCP/Hetzner)。
3. **纯 API(不推荐)**:`orderprocessor quickPurchase` + 付费 hCaptcha 服务解 `checkout_free_prod` 的 siteKey 拿 `captchaToken`,
   再打 `confirm-order`。链路上所有 4 个端点都是第三方可随时改的内部 API,且 `xal`(Talon 反欺诈指纹)无法纯 Python 复刻。

---

## 2. 请求序列(端点 / 头 / 体 / 响应,带出处)

Epic 的「领取」在服务端由两条并行链路组成,**二选一**;

### 链路 A:Launcher quickPurchase(纯 API,能领 F2P/DLC;周免返回 CHECKOUT)

出处:`KingHacker9000/Claim-Free-Games/src/epic-api.ts` 第 100-136 行(actor 实测代码);
`SzymonLisowiec|Revadike/node-epicgames-client/resources/Endpoint.js` 中 `ORDER_QUICKPURCHASE`。

```
POST https://orderprocessor-public-service-ecomprod01.ol.epicgames.com
     /orderprocessor/api/shared/accounts/{account_id}/orders/quickPurchase
     ?country={CC}&locale={locale}
Authorization: bearer {eg1 access_token}
Content-Type: application/json
User-Agent: UELauncher/18.0.0 ...
```
Body:
```json
{
  "salesChannel": "Launcher-purchase-client",
  "entitlementSource": "Launcher-purchase-client",
  "returnSplitPaymentItems": false,
  "lineOffers": [{ "offerId": "<offerId>", "quantity": 1, "namespace": "<namespace>" }]
}
```
响应特征:
- `{"quickPurchaseStatus":"SUCCESS"}` → 已下单,仍需用 entitlement API 复核所有权(`epic-api.ts` 第 138-152 行 `waitForOwnership`)。
- `{"quickPurchaseStatus":"CHECKOUT"}` → Epic 要求走 web checkout → **周免基础游戏的典型结果**(`claimer.ts` 第 39-42 行)。
- `{"quickPurchaseStatus":"REACHED_PURCHASE_LIMIT"}` → 已拥有(`Jonathan8520/.../claimer.py` 第 137-155 行)。
- 无 token 时(本机 2026-10-06 实测):**HTTP 401**,头 `x-epic-error-name: errors.com.epicgames.common.authentication.authentication_failed`,
  `x-epic-error-code: 1032`。该端点**不在 Cloudflare 后面**(响应直接是 Epic JSON)。

### 链路 B:egs-platform-service quickPurchase(移动商店服务;现被 Cloudflare 挡)

出处:`Jonathan8520/.../claimer.py` 第 11-19、105-160 行。

```
POST https://egs-platform-service.store.epicgames.com/api/v2/private/egs/purchase/quickPurchase
Authorization: Bearer {access_token}
Content-Type: application/json
```
Body:
```json
{ "country": "FR", "locale": "fr",
  "lineOffers": [{ "offerId": "<offerId>", "namespace": "<namespace>" }],
  "salesChannel": "Windows-Store-EGSWeb" }
```
响应特征:
- 周免 BASE_GAME:HTTP 400 `Offer is not eligible`(`AUTO_CLAIM_FINDINGS.md` 表;`claimer.py` 第 149-152 行)。
- 本机 2026-10-06 实测:无鉴权 POST 返回 **HTTP 403 + Cloudflare challenge 页**
  (`cf-mitigated: challenge`,`server: cloudflare`,域名属 `store.epicgames.com` 子域)。

### 链路 C:Web checkout(payment-website-pci;浏览器路径,需 captchaToken)

这是浏览器/人实际走的最终链路。出处:`node-epicgames-client/src/Client/index.js` 第 592-677 行;
`MajorTom3K1M/epic-games-auto-claim/lib/purchase.js` 第 57-107 行;`Jonathan8520/.../AUTO_CLAIM_FINDINGS.md`。

1. 取 purchaseToken(会话态,HTML 里带 CSRF 味道的值):
```
GET https://www.epicgames.com/store/purchase?showNavigation=true&namespace={ns}&offers={offerId}
  -> HTML 中含 <input id="purchaseToken" value="...">
```
(源:`node-epicgames-client/src/Client/index.js` `newPurchase`,第 592-598 行;
`ugs` `PORTAL_ORIGIN = ue-launcher-website-prod.ol.epicgames.com` 同文件 `resources/Endpoint.js`)

2. 预览订单:
```
POST https://payment-website-pci.ol.epicgames.com/purchase/order-preview
Authorization: {tokenType} {access_token}      # eg1 ...
x-requested-with: {purchaseToken}
Content-Type: application/json
{ "useDefault": true, "setDefault": false, "namespace": "{ns}", "country": null,
  "offers": ["{offerId}"], "offerPrice": "", "orderId": null, ... }
  -> 返回含 syncToken 的对象(syncToken 缺失视为失败)
```

3. 确认订单(**周免需要 captchaToken**):
```
POST https://payment-website-pci.ol.epicgames.com/v2/purchase/confirm-order
Authorization: {tokenType} {access_token}
x-requested-with: {purchaseToken}
Content-Type: application/json
{ "totalAmount": 0, "redeemRewardAmount": 0, "canQuickPurchase": true,
  "storePaymentMethod": false,
  "originatingRequest": "https://store.epicgames.com/p/{slug}?lang=..&purchaseToken={purchaseToken}",
  "captchaToken": "<hCaptcha Enterprise token — JAW HAR 实测约 15640 chars>" }
  -> { "orderResponse": { "orderStatus": "COMPLETED", "orderId": "..." } }
```
- 无 captchaToken / captcha 挑战失败时返回
  `errors.com.epicgames.purchase.purchase.captcha.challenge`
  (源:`node-epicgames-client/src/Http.js` 第 96-101 行)。
- 浏览器路径下 UI 上呈现为 iframe `#h_captcha_challenge_checkout_free_prod`
  (源:本地 `vendor/free-games-claimer/epic-games.js` 第 313-345 行)。

### 关于 GraphQL `Checkout` / `claim` mutation

**不存在公开的 GraphQL 结算 mutation。** 全库代码检索(`gh search code "mutation Checkout"`、各项目源码)
与逆向文档(`LeleDerGrasshalmi/FortniteEndpointsDocumentation`)均未发现 store checkout 的 GraphQL mutation。
结算固定发生在 REST:`payment-website-pci.ol.epicgames.com/v2/purchase/*` + `orderprocessor.../quickPurchase`。
GraphQL(`store.epicgames.com/graphql`)只用于**发现/校验**:
- `searchStoreQuery`(sha256 `7d58e12d9dd8cb14c84a3ff18d360bf9f0caa96bf218f2c5fda68ba88d68a437`)— 源:`claabs/.../src/puppet/free-games.ts` 第 45-75 行。
- `getOffersValidation`(sha256 `3c9bb0f213f6d0cb6bf056e6b206ba166c8dd59d014618e4d59bff11689f403a`)— 源:`claabs/.../free-games.ts` 第 235-270 行;`Jonathan8520/.../claimer.py` 第 24 行。
- `getMappingByPageSlug`(sha256 `5a08e9869c983776596498e0c4052c55f9e54c79e18a303cd5eb9a46be55c7d7`)— 源:`Revadike/.../src/gamePromotions.js` 第 5 行。
- `getCatalogOffer`(sha256 `abafd6e0aa80535c43676f533f0283c7f5214a59e9fae6ebfb37bed1b1bb2e9b`)— 源:`claabs/.../free-games.ts` 第 305-325 行。

注意:`store.epicgames.com/graphql` 实测在本机(住宅 IP + curl)就直接返回 Cloudflare 挑战页(第 3 节),所以
纯 API 方案若要调 GraphQL 也必须处理 Cloudflare。

---

## 3. 已知障碍与证据

### 3.1 hCaptcha(Talon 反欺诈)—— 最硬的障碍

- 网页 checkout 的收费是 hCaptcha Enterprise;错误码 `errors.com.epicgames.purchase.purchase.captcha.challenge`
  (源:`node-epicgames-client/src/Http.js` 第 99 行;本地 `README.md:32`、`vendor/free-games-claimer/epic-games.js` 第 313-320、345 行)。
- 领取前的 hCaptcha 不是独立 widget,而是 **Talon 反欺诈服务**主导:
  `talon-service-prod.ecosec.on.epicgames.com/v1/init`(flow `checkout_free_prod`)下发动态 siteKey,
  `/v1/init/execute` 执行浏览器指纹,返回的 `captchaToken` 交给 `confirm-order`。
  (源:`Jonathan8520/.../AUTO_CLAIM_FINDINGS.md`「Le vrai parcours d'un claim」;`claimer_api.py` 第 63-95 行)
- `AUTO_CLAIM_FINDINGS.md` 明确:captchaToken 由真实浏览器**被动**生成(无需点图),或用付费打码服务换;
  纯 Python 复刻 Talon 的 `xal`(6828 chars 的 JS 反 bot 载荷)「impossible à reproduire en Python pur」。
- 该文件还记录了实测:同一账号在 Chrome/Windows 住宅线上 captcha 是**被动通过**;在 Oracle VM(Xvfb)
  每次都弹图片挑战;换住宅 IP、换指纹、换 Chrome 全无效。

### 3.2 Cloudflare 拦机房 IP(2026)

- `AUTO_CLAIM_FINDINGS.md`:「Toutes les IPs cloud sont flaguées par Cloudflare en 2026」(Azure/AWS/Oracle/GCP/Hetzner/OVH);
  GH Actions 实测截图报「Vérifiez que vous êtes un humain」+ Azure IP。
- 本机 2026-10-06 实测(住宅 IP):
  - `POST https://store.epicgames.com/graphql` → **Cloudflare challenge 页**(`cf_challenge_text_small`)。
  - `POST https://egs-platform-service.store.epicgames.com/.../quickPurchase` → **HTTP 403 + `cf-mitigated: challenge`**。
  - `POST https://orderprocessor-public-service-ecomprod01.ol.epicgames.com/.../quickPurchase` → **HTTP 401 Epic JSON,无 CF 挑战**。
  - `POST https://payment-website-pci.ol.epicgames.com/v2/purchase/order-preview` → **HTTP 401,无 CF 挑战**。
  - `POST https://talon-service-prod.ecosec.on.epicgames.com/v1/init` → **HTTP 400 Epic JSON**(CF 在边缘但不挑战该请求)。
- 含义:`*.ol.epicgames.com`(orderprocessor / payment-website)与部分 `*.on.epicgames.com`(talon)
  即便从机房 IP 也有机会直连;但 `store.epicgames.com` 及其子域(含 GraphQL 与 egs-platform)会挡。
  这与 `AUTO_CLAIM_FINDINGS.md`「`*.ol.epicgames.com` 和 `*.ecosec.on.epicgames.com` 不在 Cloudflare」基本一致,
  但**需要修正**:`egs-platform-service.store.epicgames.com` 是 `store.epicgames.com` 子域,仍在 Cloudflare 后面。

### 3.3 quickPurchase 对周免「结构性拒绝」

- Jonathan 2026-05-23 实测表(住宅 FR IP,未拥有的 Tomb Raider / Down in Bermuda):
  - `store.epicgames.com/api/order/v3/...`(legacy)→ hCaptcha HTML,拦。
  - `orderprocessor.../quickPurchase` → `quickPurchaseStatus: CHECKOUT`,未完成。
  - `egs-platform-service.../quickPurchase` → HTTP 400 `Offer is not eligible`。
  结论原文:「Epic refuse structurellement le claim API pour les BASE_GAME hebdo, même non possédés.」
  (源:`AUTO_CLAIM_FINDINGS.md`「Ce qu'on a découvert sur Epic en 2026」)
- 现役项目 `KingHacker9000/Claim-Free-Games`(2026-09)也把 `CHECKOUT` 当「升级到浏览器」的信号:

```
if (response?.quickPurchaseStatus === 'CHECKOUT') { ...escalating to browser fallback... return false; }
```
(源:`src/claimer.ts` 第 39-42 行)

### 3.4 历史项目陆续停掉纯 API

- `MajorTom3K1M/epic-games-auto-claim` README 首行:「**This project is no longer functional due to API and
  security changes implemented by Epic Games.**」其 `lib/purchase.js` 正是纯 HTTP 的 order-preview + confirm-order 实现。
- `claabs/epicgames-freegames-node`(最活跃,2026-10-02)已**不再自动购买**:
  `Readme.md:4`「Sends you a prepopulated checkout link so you can complete the checkout after logging in.」、
  `Readme.md:260`「`noHumanErrorHelp`: purchase is no longer automated」;
  `src/index.ts` 第 60-70 行只 `generateCheckoutUrl(offers)` 后 `sendNotification(...PURCHASE...)`。
- `onyxhq-dev/epicgames-claimer`(2026-06-22 提交信息)`refactor: remove Playwright/CapSolver, revert to
  notification-only flow` —— 试过浏览器 + CapSolver 后回到只通知。
- `Revadike/epicgames-freebies-claimer` 最后活跃 2022-11-21,issue #61「Failed to claim (Error: You need to
  solve CAPTCHA!)」自 2020-10-16 起仍 OPEN。
- `EdNovas/epicgames` 是 `luminoleon/epicgames-claimer` 的拷贝(`main.py:18-19` 仍指向 `luminoleon/epicgames-claimer`
  的 API);`luminoleon/epicgames-claimer` 仓库现已不存在(`gh repo view` 解析失败),该线路由 pyppeteer 浏览器点击驱动。

### 3.5 用户本项目已踩到的坑(现状)

- 引擎报错原文:`Failed to claim! To avoid captchas try to get a new IP address.`
  (源:`vendor/free-games-claimer/epic-games.js` 第 345 行;即机房 IP 触发反欺诈)。
- token 无法注入 cookie 路:access token 4529 字节 > 浏览器单 cookie 上限约 4000 字节,
  `injectSession` 直接跳过(`src/inject.js` 第 13-16、27-30 行);引擎实际靠持久化 profile 里的 web 会话。

---

## 4. 各项目对比表

| 项目 | 最后活跃 | 方法 | 关键端点 / 参数 | 2026 是否适用 |
| --- | --- | --- | --- | --- |
| `Revadike/epicgames-freebies-claimer` | 2022-11-21 | **API**(`node-epicgames-client`) | `client.purchase()` → portal purchase 页取 `#purchaseToken` → `order-preview` → `confirm-order`;`newPurchase` 用 `ue-launcher-website-prod.ol.epicgames.com/purchase` | 否(issue #61 captcha 长期未解) |
| `node-epicgames-client`(Revadike 依赖) | 2022-01-01 | **API**(launcher) | 同上;`Http.js` 识别 `purchase.purchase.captcha.challenge` | 作为端点/参数参考仍有效,不可直接跑 |
| `claabs/epicgames-freegames-node` | 2026-10-02 | **混合 → 现为通知** | 浏览器登录/EULA/device-auth + `searchStoreQuery`/`getOffersValidation`;购买已移除,只发 `generateCheckoutUrl` 链接 | 是(领取靠用户点链接) |
| `QIN2DIM/epic-awesome-gamer` | 2025-11-07 | **浏览器** + hCaptcha solver | Playwright + `hcaptcha-challenger` `AgentV`;购物车 + `payment-order-confirm` iframe | 部分(依赖 hCaptcha solver,机房 IP 易被拦) |
| `luminoleon/epicgames-claimer` | 仓库已消失 | 浏览器(pyppeteer) | 见 `EdNovas` 拷贝:`purchase_url` = `www.epicgames.com/store/purchase?namespace=..&offers=..` | 否(仓库不存在) |
| `EdNovas/epicgames` | 2022-04-14 | 浏览器(pyppeteer) | `epicgames_claimer.py` `purchase_url`(同 luminoleon) | 否(老) |
| `huisunan/epic4j` | 2022-06-08 | 浏览器(Java) | `MainStart.java` 点击 `purchase-cta-button` → `#webPurchaseContainer iframe` → `#purchase-app button[class*=confirm]` | 否(老) |
| `HarLin97/Epicgame-Action` | 2026-01-05 | **API**(Revadike 分支 v1.5.3) | `client.purchase(offer,1)`;显式处理 `captcha.challenge` 中止 | 端点在,但同 captcha 障碍 |
| `MajorTom3K1M/epic-games-auto-claim` | 2024-12-05 | **API** | `lib/purchase.js` order-preview + confirm-order(带 captcha 分支) | 否(README 自述失效) |
| `Jonathan8520/epic-free-games-discord` | 2026-10-01 | **API 研究 + 浏览器** | `claimer_api.py`(Talon init + CapMonster + confirm-order)、`claimer.py`(quickPurchase)、`claim_browser.py` | 结论:纯 API 对周免不可行;代码是极佳参考 |
| `KingHacker9000/Claim-Free-Games` | 2026-09-04 | **API-first + 浏览器兜底** | `quickPurchase`(orderprocessor)+ entitlement 复核;`CHECKOUT` → Patchright 浏览器 | 现役最接近目标,但周免仍要浏览器 |
| `onyxhq-dev/epicgames-claimer` | 2026-06-22 | 通知(原浏览器+CapSolver) | device_auth 登录 + 生成 checkout URL 通知 | 是(领取仍靠人点) |
| `P-Adamiec/Free-Games-Claimer-Remaster` | 2026-10-04 | **浏览器** + VNC | vogler 风格;checkout 里 hCaptcha 交人解 | 部分(需 VNC 解 captcha) |
| `vogler/free-games-claimer`(本项目 vendor) | 2026-09-02 | **浏览器** | store 页点击 → `#webPurchaseContainer iframe` → `confirm-order` | 是(就是现状) |

补充:
- `spin311/epic-free-games-claim`(2026-08-30)是**浏览器扩展**,content script 注入商店页点击
  (`wxt-dev-wxt/entrypoints/epic.content.ts`),不是 API。
- `P-Adamiec/.../src/stores/epic_mobile.py` 第 3 行注释「Detection only: the games themselves are claimed
  by `epic.py` on the very same」:移动免费游戏只做发现,领取仍回到 `epic.py` 的浏览器。

---

## 5. device auth token 能否直接用于 API 领取?

### 5.1 我们的 token 与所需 scope 不匹配(重要)

- 本项目设备授权用的是 `fortniteNewSwitchGameClient`,`client_id = 98f7e42c2e3a4f86a74eb43fbb41ed39`
  (`src/oauth.js` 第 11-14 行;`docs/auth.md` 第 1 节)。
- 在 EpicResearch 的权限清单里,**只有 3 个 client 有 `orderprocessor ... quickPurchase` 权限**:
  - `launcherAppClient2`(`34a02cf8f4414e29b15921876da36f9a`)→ `orderprocessor:shared:order:{accountId}:quickPurchase` Create、
    `:create`、`:freePurchase`、`:preview`,以及 `launcher:purchase:offers` Read。
    源:`MixV2/EpicResearch/docs/auth/permissions/34a02cf8f4414e29b15921876da36f9a.md`
  - `fortniteComClient`(`cd2b7c19...`)、`utcomClient`(`f0b883ba...`)→ `orderprocessor:shared:order:{accountId}:*`。
- `fortniteAndroidGameClient`(`3f69e56c...`,onyxhq 用的移动 client)**没有任何 orderprocessor 权限**。
- `fortniteNewSwitchGameClient`(`98f7e42c...`)**在权限目录里没有对应文件**(仅出现在 `auth_clients.md`),
  即无据可查其具备 quickPurchase 权限 —— 保守判断:**不能**。
- 结论:用本项目现有 token 直接调 `orderprocessor quickPurchase` 很可能拿到 401/403(权限不足),
  而不是「能调但被 captcha 挡」。要拿到带 quickPurchase 权限的 token,需以 `launcherAppClient2` 走
  `authorization_code`(浏览器登录 `https://www.epicgames.com/id/api/redirect?clientId=34a02cf8...&responseType=code`)
  —— 这正是 `KingHacker9000/Claim-Free-Games` 的 `npm run auth` 和 legendary 的做法。

### 5.2 web 会话与 token 的关系

- web 端登录态 = `EPIC_BEARER_TOKEN` cookie = OAuth `access_token` 原样(含 `eg1~` 前缀),
  域 `.epicgames.com` 等,`Max-Age` 28800(`docs/auth.md` 第 3 节;`src/inject.js` 第 5-6、31-45 行;
  `claabs/.../src/puppet/base.ts` 第 91-115 行)。
- token(launcher 语义)与 web 会话在服务端会互相「换票」:站点用 bearer 换内部 `EG1`/会话 cookie。
  但 `store.epicgames.com` 的 Cloudflare 挑战在**网络层**,与 token 有效性无关。
- 换算路径(需要时):
  1. `authorization_code`(launcherAppClient2):浏览器登录后拿 code → `oauth/token`;得到 launcher access/refresh token。
  2. `device_auth`(account_id + device_id + secret):先有有效 token 才能通过
     `POST /account/api/public/account/{account_id}/deviceAuth` 创建,之后可不过期续票
     —— onyxhq 用此路(`app/claimer.py` 第 55-100 行),但**仍绑该 client 的权限**。
  3. `token_to_token`:可「用旧 token 换新 token」,但 **EpicResearch 记为「deprecated on all public clients」**,
     别指望它换到别的 client 的权限(`docs/auth/grant_types/token_to_token.md`)。
- 我们的 token 走 device_code(`src/oauth.js` 第 74-83 行),属于 fortniteNewSwitch client 的会话,
  想升级到 launcher 权限必须**重新登录一次 launcherAppClient2**。

---

## 6. HTTP Toolkit + adb 抓包:可行性、成本、产出

### 官方文档怎么说(adb 模式)

来源:HTTP Toolkit 官方指南 <https://httptoolkit.com/docs/guides/android/>(2026-10-06 读取)。

- 通用「Android device」流程:装 HTTP Toolkit → 点 Android 拦截 → 手机装 HTTP Toolkit app → 扫码 →
  授权 VPN + 安装用户级 CA。适用于 Chrome/webview 及信任用户 CA 的 app。
- **要抓不信任用户 CA 的第三方 app(如 Epic 客户端),必须用 ADB 模式注入系统级 CA**。官方支持列表:
  - rooted 真机
  - 官方模拟器(标准 **Google API / AOSP** 构建,**不含 “Google Play” 构建**)
  - Genymotion 模拟器
  - 任何 `adb shell su` 或 `adb root` 可用的设备
- 操作:ADB 连上设备后,HTTP Toolkit 的 “Android device connected via ADB” 选项出现 → 点击 →
  注入系统 CA(临时文件系统,**重启即消失**)→ 自动开始拦截。
- 无 Play Store 的镜像可手动装 APK(官方建议 APKPure / APKMirror 或 Open GApps)。

### 无真机时的最小复现成本

| 项 | 说明 |
| --- | --- |
| Android SDK emulator + AVD | 需建 **Google API / AOSP**(非 Google Play)镜像方可用 adb 注入系统 CA |
| Epic Games Android APK | 从 APKPure/APKMirror 取(模拟器无 Play Store,或装 Open GApps) |
| adb 连通 | `adb devices` 可见即可,HTTP Toolkit 走 adb 注入 |
| 抓包目标 | Epic 客户端登录 + 尝试领取时的 `talon` / `payment-website-pci` / `orderprocessor` 请求(含 `captchaToken` 的形状) |

### 这条路的成本与产出

- **成本**:中等。主要坑在「镜像必须是 Google API/AOSP 非 Play(否则 `adb root`/`su` 不可用)」、
  Epic APK 版本与设备指纹、以及 Epic 客户端可能带证书固定(pinning,需 Frida 之类绕过 —— 官方文档未覆盖)。
- **产出**:能拿到 Android 端领取的真实请求序列(尤其是 `xal` 指纹字段与 `captchaToken` 是否与 web 一致)。
  但**走这条路的前提是「Epic Android 客户端本身能领取周免游戏」**,这一点本次未取得一手证据。

### 待确认(见第 8 节)

- Epic Android 客户端是否支持领取**周免 BASE_GAME**(还是只浏览商店 / 只领移动专属免费游戏)。

---

## 7. 最小验证方案(可复制粘贴,凭据用占位符)

目标:在**不依赖浏览器**的前提下,判断 (1) 发现 API 是否可用;(2) 我们的 token 是否有 quickPurchase 权限;
(3) 周免商品能否纯 API 领取。按顺序跑,任一步失败即说明该路线不通。

### 步骤 0:发现免费游戏(匿名,只读)

```bash
curl -s "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN" \
  | python -c 'import json,sys;d=json.load(sys.stdin);[print(e["title"],e["id"],e["namespace"]) for e in d["data"]["Catalog"]["searchStore"]["elements"]]'
```
本机 2026-10-06 实测:HTTP 200,返回 12 个元素,其中免费的在售有
`System Shock 2: 25th Anniversary Remaster`(offerId `7ae00c3e89174012b175cc73b4737723`,
namespace `a90f2381d7aa48c09b4080515a9541cd`)等 → **发现链路可用**。

### 步骤 1:验证 token 是否具备 quickPurchase 权限

`orderprocessor` 端点在鉴权失败时返回 **401 + JSON**(不会被 Cloudflare 挑战),所以这一步能干净地
区分「权限/令牌问题」与「业务拒绝」。

```bash
ACCOUNT_ID="<你的 account_id>"
TOKEN="<eg1~... access_token>"          # 真实 token,勿外传
curl -s -o /tmp/qp.json -w 'HTTP %{http_code}\n' \
  -X POST "https://orderprocessor-public-service-ecomprod01.ol.epicgames.com/orderprocessor/api/shared/accounts/${ACCOUNT_ID}/orders/quickPurchase?country=CN&locale=zh-CN" \
  -H "Authorization: bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"salesChannel":"Launcher-purchase-client","entitlementSource":"Launcher-purchase-client","returnSplitPaymentItems":false,"lineOffers":[{"offerId":"7ae00c3e89174012b175cc73b4737723","quantity":1,"namespace":"a90f2381d7aa48c09b4080515a9541cd"}]}'
cat /tmp/qp.json
```
判读:
- `x-epic-error-name: errors.com.epicgames.common.authentication.authentication_failed` / 401/403
  → **该 token 无 quickPurchase 权限**(与本项目 fortniteNewSwitch client 的预期一致)→ 纯 API 不可行。
- `{"quickPurchaseStatus":"SUCCESS"}` → API 领取成功(非周免情形;用步骤 2 复核)。
- `{"quickPurchaseStatus":"CHECKOUT"}` → Epic 要求 web checkout(周免的典型结果)→ 纯 API 不可行。
- `REACHED_PURCHASE_LIMIT` → 已拥有。

### 步骤 2:用 entitlement API 复核是否真的到手

```bash
curl -s "https://entitlement-public-service-prod08.ol.epicgames.com/entitlement/api/account/<ACCOUNT_ID>/entitlements?start=0&count=1000" \
  -H "Authorization: bearer <TOKEN>" | python -c 'import json,sys;print(len(json.load(sys.stdin)))'
```
(源:`cfg/src/epic-api.ts` 第 87-99 行 `fetchEntitlements`)

### 步骤 3:验证 `store.epicgames.com/graphql` 的 Cloudflare 前置(只读)

```bash
curl -s -X POST "https://store.epicgames.com/graphql" \
  -H "Content-Type: application/json" -H "User-Agent: Mozilla/5.0" \
  -d '{"operationName":"getOffersValidation","variables":{"offers":[{"offerId":"7ae00c3e89174012b175cc73b4737723","namespace":"a90f2381d7aa48c09b4080515a9541cd"}]},"extensions":{"persistedQuery":{"version":1,"sha256Hash":"3c9bb0f213f6d0cb6bf056e6b206ba166c8dd59d014618e4d59bff11689f403a"}}}'
```
本机 2026-10-06 实测:返回 **Cloudflare challenge 页**(`cf_challenge_text_small`)。

### 说明

- 步骤 1 的 `TOKEN` 必须是 **launcherAppClient2** 签发的 `eg1~` token 才有意义;本项目现有
  fortniteNewSwitch token 大概率直接 401(这本身就是结论之一)。
- 全部步骤都是只读/一次 POST,不创建订单除非真的 `quickPurchase` 成功;若想完全无副作用,
  把步骤 1 的 offerId 换成不存在的 UUID(会得到业务错误码而非下单)。

---

## 8. 未解问题(需抓包或实测才能定)

1. **Epic Android 客户端能否领取周免 BASE_GAME?** 无一手证据。若不能,HTTP Toolkit + adb 路线对「周免领取」无产出。
   相关线索:`egs-platform-service.../quickPurchase` 是移动服务,但对周免返回 `not eligible`(§3.3)。
2. **launcherAppClient2 的 device_code / device_auth 是否可用**:本项目希望不重登就升级到 launcher 权限,
   但 `token_to_token` 已 deprecated(§5.2);`authorization_code` 需浏览器登录一次。是否有免浏览器入口未验证。
3. **Talon 的 `xal` 指纹与 `captchaToken` 的确切绑定**:`AUTO_CLAIM_FINDINGS.md` 说 `xal` 是 6828 chars 的 JS 载荷、
   纯 Python 不可复刻,但未附可复现的字段级 HAR(仓库里的 `_parse_har*.py` 只是解析脚本,无 HAR 样本)。
4. **付费 hCaptcha 服务的实际可用性**:Jonathan 记录 CapMonster 基础套餐不支持 hCaptcha(`ERROR_TASK_NOT_SUPPORTED`),
   未测 2Captcha / CapSolver;且 Talon 是否只认「浏览器被动 token」而非第三方 solver token,未验证。
5. **Cloudflare 对 `store.epicgames.com` 的挑战是否只针对无头/curl**:本机(住宅)curl 也被挑战,
   但真实浏览器过闸正常;纯 HTTP 方案需要什么样的 TLS 指纹/UA/cookie 才能过,未系统测试。
6. **`orderprocessor quickPurchase` 对周免到底是永远 `CHECKOUT` 还是与账号/IP 相关**:
   同一天 Jonathan 在住宅 FR IP 得 `CHECKOUT`,GH Actions 得 `not eligible`(§3.3);差异原因未查明。
7. **结论的时效**:本轮调研基于 2026-05~10 的仓库与实测;Epic 未公开这些内部 API 的变更日志,
   需定期用第 7 节脚本复验。

---

## 附录:来源清单(仓库 + 关键文件)

本地:
- `proj-epic-free-games\src\{oauth,tokens,auth,inject,engine}.js`
- `...\vendor\free-games-claimer\epic-games.js`(vogler, commit `f282d3c`, 2026-09-02)
- `...\docs\auth.md`、`...\PLAN.md`、`...\README.md`

上游(本轮克隆到 `<克隆目录>/epic-research\`):
- `Revadike/epicgames-freebies-claimer`(2022-11-21)、`SzymonLisowiec/node-epicgames-client`(2022-01-01)
- `claabs/epicgames-freegames-node`(2026-10-02)
- `QIN2DIM/epic-awesome-gamer`(2025-11-07)、`HarLin97/Epicgame-Action`(2026-01-05)
- `EdNovas/epicgames`(2022-04-14)、`huisunan/epic4j`(2022-06-08)
- `MajorTom3K1M/epic-games-auto-claim`(2024-12-05)
- `Jonathan8520/epic-free-games-discord`(2026-10-01)、`KingHacker9000/Claim-Free-Games`(2026-09-04)
- `onyxhq-dev/epicgames-claimer`(2026-06-22)、`P-Adamiec/Free-Games-Claimer-Remaster`(2026-10-04)
- `MixV2/EpicResearch`(auth_clients / permissions)、`LeleDerGrasshalmi/FortniteEndpointsDocumentation`

官方文档:
- HTTP Toolkit Android 抓包:<https://httptoolkit.com/docs/guides/android/>
- Epic Online Services Auth:<https://dev.epicgames.com/docs/web-api-ref/authentication>(本地 `docs/auth.md` 引用)

本机实测(2026-10-06,住宅 IP):
- `freeGamesPromotions` → 200;`store.epicgames.com/graphql` → Cloudflare 挑战;
  `orderprocessor/quickPurchase`(无鉴权)→ 401 Epic JSON;`egs-platform-service/.../quickPurchase` → 403 CF challenge;
  `payment-website-pci/v2/purchase/order-preview` → 401;`talon/v1/init` → 400 Epic JSON。
