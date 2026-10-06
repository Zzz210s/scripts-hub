# 杉果(Sonkwo)App「自动领取」调研

日期:2026-10-06
范围:只读调研,未改动任何现有代码;未登录任何账号;未打印任何凭据。
一手来源:杉果官网/官方前端 bundle、杉果公开 API 实测(本机 curl,只读 GET)、GitHub 搜索。二手来源只用于指路。

---

## 0. 一句话结论

**这条路存在,但不是「脚本」,是「App 里的官方代领」——对机房 IP 被 Epic 反欺诈拦住的场景可能有实际用处,但当前无法用 HTTP 脚本复刻。**

具体:杉果确实是 Epic 在中国的对接方之一 —— 它有 Epic 官方 OAuth 授权(client_id `xyza7891jynCnY2wGH214dRXGSXYOyxz`)、能绑定用户 Epic 账号、并在**手机 App 里提供「Epic 喜加一」一键领取**;网页端(`/mobile/epic_plus_one`)只负责展示 Epic 当期免费游戏清单并**引导用户打开 App 领取**。也就是说,**领取动作在杉果 App 内完成,不在网页,也不在杉果 PC 客户端**。

对「机房 IP 被 Epic 拦」的价值:如果杉果的领取是走它自己的服务器/它自己的 Epic OAuth token(证据强烈指向这一点),那么**你的服务器 IP 是不是被 Epic 拦就显得无关紧要** —— 领取不再是你的 IP 去发起的。**但代价是**:这条链路目前只有 App 能做,公开代码里**没有任何人写过杉果的 Epic 自动领取脚本**(只找到签到脚本和提 Key 脚本),所以它不能被直接搬进无人值守的服务器流水线,除非先抓包复刻 App 的领取请求。

出处(汇总,详见后文):
- 杉果账号页 `/setting/game_account_management`(官网 SSR 文本):「Epic 绑定Epic账号…未绑定,绑定操作需要在APP端进行」
- 杉果前端 bundle 里的 `epicPreSignin` / `third_authorize/epic` / `/api/epic/activation.json`
- 杉果官方 `AGENTS` 文档(前端自带):`/mobile/epic_plus_one`「Epic 喜加一…引导用户前往 APP 领取」
- 本机 2026-10-06 实测 `GET https://api.sonkwo.cn/epic/game/freeList` 返回 Epic 当期免费清单

---

## 1. 杉果是什么

杉果游戏(Sonkwo)是中国大陆的正版游戏发行/零售平台,运营主体为**北京中电博亚科技有限公司**(官网页脚署名,ICP 备 12041226 号,来源:https://www.sonkwo.cn 页脚)。

形态:

| 形态 | 地址/标识 | 说明 |
| --- | --- | --- |
| 官网(中国大陆站) | https://www.sonkwo.cn (旧域名 sonkwo.com 301 到 .cn) | React/Remix SSR 应用;核心功能:商店、社区、点卡、**果豆商城**、任务/签到、领券大厅 |
| 海外/香港站 | https://www.sonkwo.hk | 同一套前端,域名与 API 走 .hk |
| 社区 | https://club.sonkwo.cn | 论坛/讨论组 |
| 帮助中心 | https://support.sonkwo.cn | SPA(本次未能拉到具体文档内容) |
| Android App | 包名 `com.sonkwoapp`(来源:前端 bundle 中 `a.app.qq.com/o/simple.jsp?pkgname=com.sonkwoapp`;应用宝页 https://sj.qq.com/appdetail/com.sonkwoapp) | 官方称「玩家生态聚合平台」;关键能力:**Epic 账号绑定必须在 App 端进行**、Epic 喜加一领取 |
| iOS App | App Store id `1041859825`(来源:bundle 中 `apps.apple.com/cn/app/id1041859825`) | 同上 |
| PC 客户端 | 官网导航「客户端」 | 存在但**不承担 Epic 绑定/领取**(官网明确写绑定要在 App 端) |

功能(官网导航与页面实证):买游戏/激活码(Steam/Uplay/Epic/Bnet/…各平台 key,含「无 Key 直入库」`epic_keyless`)、预购、促销、点卡、果豆商城、签到赚果豆、任务中心、抽奖、福袋、社区点评。

---

## 2. 杉果与 Epic 的关系(一手证据)

**结论:杉果是 Epic 的授权对接方,具备 Epic 官方 OAuth 授权和「把游戏直接激活进你的 Epic 账号」的能力,并在 App 内提供 Epic 免费游戏一键领取。** 注意:不是「杉果=Epic 中国代理」这种唯一代理关系,而是杉果作为发行/零售方接入了 Epic。

证据逐条:

1. **Epic 账号绑定入口**(官网账号页,SSR 文本,https://www.sonkwo.cn/setting/game_account_management):
   - `Steam —— 绑定Steam账号,以获得更多数据展示`
   - `Epic —— 绑定Epic账号,以获得更多数据展示`
   - `未绑定,绑定操作需要在APP端进行`

2. **Epic OAuth(前端 bundle 函数 `epicPreSignin`)**:
   跳转到 `https://www.epicgames.com/id/login?prompt=login&response_type=code&client_id=<杉果的 Epic client_id>&redirectUrl=https://<域名>/third_authorize/epic`
   - 正式 client_id:`xyza7891jynCnY2wGH214dRXGSXYOyxz`
   - 测试 client_id:`xyza7891BGtpZTKgcvMDahidmMJ4UWGn`
   - 回调路由:`/third_authorize/epic`
   即杉果有一个注册在 Epic 名下的 OAuth 应用,走标准 authorization code 流程 —— 意味着杉果能拿到用户的 Epic 授权,替用户在 Epic 侧操作。

3. **Epic 游戏激活(无 Key 直入库)**:
   - 前端调用 `POST {host}/api/epic/activation.json?id=<id>`,`Accept: application/vnd.sonkwo.v8+json`
   - 商品类型枚举里同时有 `epic_key`(给激活码)与 `epic_keyless`(直接激活进绑定账号)
   - 文案:`act_game_bind_epic = "激活此游戏需要绑定您的Epic账号"`、`bind_epic_hint = "请在账号安全页面,绑定Epic账号..."`

4. **Epic 免费游戏清单(公开)**:
   `getEpicFreeList` → `GET https://api.sonkwo.cn/epic/game/freeList`(本机实测 200,详见第 4 节)。

5. **App 内「Epic 喜加一」页(官方自带文档)**:
   `/mobile/epic_plus_one` 的 `AGENTS` 文档原文:功能概述 = **「Epic 免费游戏列表页,展示当前免费和即将免费的游戏,引导用户前往 APP 领取。」**;关键组件 `AwakeAppBtn(唤醒 APP 按钮)`;数据来源 `@m-Actions/SecKillAction.getEpicFreeList`;注意事项「仅大陆站页面」「旧路由 `/mobile/epic_free` 保留兼容重定向」。

6. **App 任务系统里有 `epicOneClick` 任务**(前端 bundle 枚举 `{...,jumpPage:10,epicOneClick:11,addCart:12,...}`)—— 说明 App 内确实有「Epic 一键领取」这一动作,并被计入果豆任务。

---

## 3. 找到的脚本/项目清单

搜索范围:GitHub(repos/code/issues,`gh search`)、Gitee(API + 网页);关键词 `sonkwo`、`杉果`、`杉果 签到`、`杉果 脚本`、`杉果 自动领取`、`sonkwo epic`、`epic/game/freeList`、`api.sonkwo.cn`、`com.sonkwoapp`。

**结论:没有任何「杉果 Epic 自动领取」脚本;公开的全是签到、提 Key、爬虫、App 仿写。** 与 Epic 相关的杉果代码,只有杉果自己前端 bundle 里的那几行(见第 4 节),没有第三方脚本。

| 仓库 | 语言 | 最后活跃(2026-10-06 查) | 实现方式 | 关键内容 |
| --- | --- | --- | --- | --- |
| [chr233/GM_Scripts](https://github.com/chr233/GM_Scripts)(子文件 `Sonkwo/Auto_Sign.js`) | JavaScript(油猴) | 活跃 | UI 自动化(点页面按钮) | 「杉果自动签到」:找 `div.SK-button-com.sign-btn>button` 文本为「签到赚积分」就 click,把 task 链接改成 generaltask。**纯前端 DOM,不是 API** |
| [inory121/tamperscript](https://github.com/inory121/tamperscript)(`Sonkwo-AutoCheckin.user.js`) | JavaScript(油猴) | 中等 | UI 自动化 | 杉果自动签到 |
| [Revadike/gm_scripts](https://github.com/Revadike/gm_scripts)(`Enhanced_sonkwo.user.js`、`sonkwo_fetch_key.user.js`) | JavaScript(油猴) | 中等 | UI 增强 / 抓取 | 网站增强 + 提 Key |
| [deluxghost/sonkwo-gimme-key](https://github.com/deluxghost/sonkwo-gimme-key) | JavaScript(油猴) | 2026-02 | 前端脚本 | **在线提取杉果序列号(Key)**,免装客户端。README 称「杉果改邪归正支持直接提取 Key」 |
| [CreeperSan/Sonkwo_Spider](https://github.com/CreeperSan/Sonkwo_Spider) | Kotlin | 2026-02 | 爬虫 | 「弱不禁风的小爬虫」 |
| [qd-today/templates](https://github.com/qd-today/templates)(`杉果游戏.har`) | JSON(HAR 模板) | 活跃 | **HTTP API 直调(签到)** | 见第 4 节完整签到链路 |
| [wjf0214/qd-templates](https://github.com/wjf0214/qd-templates)(`杉果.har`)、[bblxsn/qd-today-templates](https://github.com/bblxsn/qd-today-templates)(`杉果游戏.har`) | JSON(HAR) | 中等 | HTTP API 直调 | 同上,时间戳更早(2021) |
| [noterpopo/Hands-Chopping](https://github.com/noterpopo/Hands-Chopping) | Java(Android/MVPArms) | 2026-04 | App 仿写 | 实现了 Steam + 杉果的每日优惠与游戏查找(练手 demo,非自动化) |
| [Oritz/community](https://github.com/Oritz/community) | Ruby(Rails) | 2021 | — | 含 `lib/sonkwo*.rb`、`spec/lib/sonkwo/*`;**疑似**杉果社区相关,未确认是否官方 |

其他:`IsThereAnyDeal/IsThereAnyDeal-Issues` 有「Add new store support for sonkwo.com/store」(说明杉果被当作正规商店聚合数据源);`RikkaApps/StorageRedirect-assets`、`xksoft/xky` 等只是收录了包名 `com.sonkwoapp`,与自动化无关。

**Epic 关键词交叉搜索无结果**:`gh search code "epic/game/freeList"`、`"api.sonkwo.cn"`、`"com.sonkwoapp"`(过滤 epic/claim/auto)均**未找到任何第三方脚本**;Gitee API 搜 `杉果`/`sonkwo` 返回空数组(`[]`,可能是未鉴权或确实没有),Gitee 网页搜索为纯 JS 渲染无法解析 —— 记为「Gitee 未找到证据」。

---

## 4. 请求链路

### 4.1 杉果签到(公开、可脚本化,成品)

来自 HAR 模板(qd-today/templates `杉果游戏.har`,原始请求可复刻):

1. 登录取 token:`POST https://auth.sonkwo.com/api/access_token.json?locale=js`
   - Header:`Accept: application/vnd.sonkwo.v1+json`,`Content-Type: application/x-www-form-urlencoded`
   - Body:`sonkwo_version=1&sonkwo_client=web&account[remember_me]=true&account[email_or_phone_number_eq]=<账号>&account[password]=<密码>`
   - 从响应 JSON 里取 `access_token`
2. 签到:`POST https://auth.sonkwo.com/api/me/clock_in.json?locale=js`
   - Header:`Authorization: Bearer <access_token>`
   - Body:`sonkwo_version=1&sonkwo_client=web`
3. 查积分(可选):`GET https://auth.sonkwo.com/api/me.json?locale=js&sonkwo_version=1&sonkwo_client=web&q[point][score]=true&...&_=<13位时间戳>`
   - 时间戳取 `https://api.m.taobao.com/rest/api3.do?api=mtop.common.getTimestamp`(HAR 里这么干的)

**人机验证:签到链路(基于 2021 与 2023 的 HAR)未见验证码**,只是普通 Bearer token 调用。(这是「旧证据」,当前是否加验需实测。)

### 4.2 杉果 Epic 免费清单(公开、可脚本化)

- `GET https://api.sonkwo.cn/epic/game/freeList` —— **本机 2026-10-06 实测 200,无需登录**。
  返回 `{"success":true,"data":[...]}`,`data[i]` 字段:
  `id, productId, offerId, namespace, name, description, coverImageUrl, startTime, endTime, viewableTime, url, isFree, isDlc, listPrice, masterId, masterInfo, owned, clientType`
  - `url` 指向 `https://store.epicgames.com/...`
  - 实测当期为 System Shock 2: 25th Anniversary Remaster、深埋之星、虎视眈眈(Out of Sight)、TerraScape…,**与 Epic 官方 `freeGamesPromotions` 返回的免费列表吻合**(本机同时调 Epic 官方接口核对,含同样的「虎视眈眈」「System Shock 2」条目)→ 杉果这份清单就是 Epic 当期免费的镜像。
- 相关(需登录,返回 `401 未登录`):`GET https://api.sonkwo.cn/epic/game/user-game/game-list`、`.../get-user-info`
- 前端还把 `POST {host}/api/epic/activation.json?id=<id>`(无 Key 直入库)、`{host}/api/epic/quotas.json` 用于激活/配额。

**这条只解决「知道什么免费/有没有领过」,不解决「替你去领」。**

### 4.3 App 领取链路(★ 关键,未拿到端点)

已确认的部分:
- 网页只会把你**深链进 App**:前端有 `sonkwoapp://` + 路径的跳转(`location.href="sonkwoapp://"+相对路径`),`epic_plus_one` 页用 `AwakeAppBtn`(唤醒 App 按钮)把用户送去 App。
- App 侧绑定 Epic 走的是 **Epic 官方 OAuth**(见第 2 节),即杉果拿到的是 Epic 的授权 code/token。
- App 有 `epicOneClick`(一键领取)任务。

未拿到的部分(需要在真机/模拟器抓包才能定):
- **App 真正发起「领取」的那个请求**:域名、路径、鉴权(Bearer?杉果签名?)、body。
- 领取是由**杉果服务器**用 OAuth token 去 Epic 下单/领取(**最可能**),还是 App 内开 Epic webview 让 Epic 自己走一遍(那 IP 就还是用户手机的 IP)。
- 是否触发 Epic 的 hCaptcha / 反欺诈。

补充:杉果走的是 Epic OAuth `response_type=code` + 服务端回调,天然适合「服务端用 refresh token 替用户操作」;这也解释了为什么网页端刻意不做领取(反爬/风控/合规都更省事)。

---

## 5. 对我们的价值判断

背景(本机既有调研,见 `docs/epic-api-claim-research.md`):周免 BASE_GAME 纯 API 领取不可行,必须过 hCaptcha;且服务器机房 IP 已被 Epic 反欺诈拦(报 `Failed to claim! To avoid captchas try to get a new IP address`)。

**能解决:**
- 如果杉果 App 的领取是**杉果服务器**代你向 Epic 发起(证据强烈指向此),那么**你的服务器 IP 被拦这件事就不再相关** —— 发起方是杉果的出口 IP + 杉果的 OAuth 授权,不是你的机器。这正好绕开「换 IP」这个死结。
- 杉果的 Epic 免费清单是公开 API,可以当**信息源**(零成本知道当期免费/是否 DLC/原价),这部分现在就能用。

**不能解决 / 风险:**
- **不能直接脚本化**:公开世界没有任何杉果 Epic 领取脚本;网页只深链 App;领取端点是 App 私有。要自动化必须**先真机抓包复刻**(需要:杉果账号、绑定的 Epic 账号、复刻 App 的鉴权/设备签名),投入与风险都比继续用浏览器引擎大。
- **平台限制**:是 Android/iOS App,不能在 Linux 服务器上跑;没有命令行版。
- **可能仍撞 Epic 风控**:即便走杉果,Epic 的领取风控也可能对杉果出口 IP 或对账号触发 captcha(未验证)。
- **需要绑定自己的 Epic 账号**:等于把 Epic 账号授权给第三方(杉果)。这是账号安全层面的取舍,需用户自己判断。
- **合规**:用第三方代领绕过平台风控,属于灰色,且有被封号风险。

**推荐**:不要把它当成服务器自动化的替代方案去投入。若要用,正确姿势是「**手机上装杉果 App + 绑 Epic 账号 + 每周手动点一下领取**」—— 这本身就是对人、对机房都最省事的形式;真要无人值守,现有浏览器引擎路线(住宅/本机 IP 跑领取)更可控。

---

## 4.5 APK 静态分析(2026-10-06 补,adb 实机取证)

用 adb 从已连接的真机(Huawei REA-AN00 / Android 15,包名 `com.sonkwoapp`)拉下 `base.apk`(64MB)后解包分析:

**技术栈**:React Native + Hermes 字节码(`assets/index.android.bundle` 7.6MB,魔数 `c61fbc03`)
+ Flutter 库 + CodePush(`assets/CodePushHash`);原生侧有 okhttp3。

**JS bundle 里的 epic 接口(字符串表取证,证明领取由杉果后端执行)**:

| 路径 | 含义 | 实测(无鉴权) |
| --- | --- | --- |
| `epic/game/user-game/takeBenefit` | **领取福利** | 404(见下) |
| `epic/game/user-game/queryTakeRecordPage` | 领取记录 | 401 未登录(存在) |
| `epic/game/queryFreeGameSummary` | 免费游戏摘要 | 200(公开) |
| `epic/game/addFreeFeedback` | 反馈 | 405(POST-only) |
| `epic/game/user-game/game-list` / `get-user-info` | 用户游戏/信息 | 401 |
| `auth/api/platform/front/bind` / `unbind` | Epic 账号绑定/解绑 | — |
| `epic_freeCallback` | WebView 回调 | — |

dex 原生侧另有 `api.sonkwo.cn/auth/session/login/refresh?locale=js&sonkwo_version=`。

**关键结论**:`takeBenefit` 的存在证明**领取动作由杉果自己的后端对 Epic 发起** —— 这与
「我们的机房 IP 被 Epic 拦」完全无关,是本路线最大的价值。

**证书固定(重要阻碍)**:APK 内含 `assets/com.sonkwoapp.cert.pem`(1992 字节,自签证书)+ okhttp3
→ 应用做了 **HTTPS pinning**。因此 HTTP Toolkit / mitmproxy 注入 CA **看不到它的流量**,
抓包必须先绕过 pinning(Frida 或改包),成本显著上升。真机未 root(`id -u` = 2000)。

**端点探测失败**:`takeBenefit` 及其 8 种变体(`/325`、`?id=325`、`take-benefit`、`benefit`、
带 productId 等)在 `api.sonkwo.cn` 上**全部 404**;`api.sonkwo.com` 不解析;
`www.sonkwo.cn/api/*` 返回 410(旧前缀已下线)。→ 真实路径需要反编译 Hermes 字节码,或用有效
登录态逐个试。

**登录链路**:旧文档里的 `auth.sonkwo.com/api/access_token.json` **已不存在**(域名不解析);
现役是 `api.sonkwo.cn/auth/session/login/...`(仅从 APK 的 dex 取证,请求形状未确认)。

**下一步(按性价比)**:
1. 反编译 Hermes 字节码(`hermes-dec` 已下载)拿到 `takeBenefit` 的调用点与参数;
2. 或用**有效杉果登录态**逐个试路径(有 token 时 401/400 与 404 可区分);
3. 抓包需先解决 pinning(Frida/改包),不建议先走。

## 4.6 领取请求已完整挖出(2026-10-06 反编译 Hermes 字节码)

用 `hermes-dec` 的 `hbc-disassembler` 反汇编 `assets/index.android.bundle`(HBC v96,输出 98MB)后,
从字符串表与调用点定位到**真正的领取接口**。之前猜的 `takeBenefit` 是**方法名**(`memberApi.takeBenefitCoupon`),
真正的 URL 是 `take`:

```
POST https://api.sonkwo.cn/epic/game/user-game/take
Authorization: Bearer <杉果登录 token>
Content-Type: application/json

{"epicUserId": "<Epic 账号 id>"}
```

**无鉴权实测(参数名靠错误信息迭代确认)**:

| 请求 | 响应 |
| --- | --- |
| `GET .../take` | 405(Method Not Allowed → 端点存在) |
| `POST .../take` `{}` | 400 `{"errorCode":1000,"errorMsg":"epic用户id 不能为空"}` |
| `POST .../take` `{"epicUserId":"abc"}` | 401 `{"errorCode":1000,"errorMsg":"未登录"}` |
| `POST .../take` `{"epic_user_id":"abc"}` / `{"userId":…}` / `{"epicId":…}` / `{"epicAccountId":…}` | 400 仍是「epic用户id 不能为空」 |

**注意:请求体里没有游戏 id** —— 它是「一键领取当期全部周免」,与 App 里的「Epic 一键领取」一致。

**登录接口(从 dex 取证,未实测)**:`POST /auth/session/login/password`(另有 `phone`、`authCode`、
`openid`、`refresh?locale=js&sonkwo_version=`)。鉴权头是标准的 `Authorization: Bearer`。
**Epic 绑定/解绑**:`/auth/api/platform/front/bind`、`/auth/api/platform/front/unbind/`(App 内一次性操作)。

**还差的一步**:有效的杉果登录态(账号密码或 token)。拿到后即可端到端验证:
登录 → 用**我们已有的 Epic account id**(OAuth token 里就有)→ 调 `take` → 看是否真的领到。

## 4.7 端到端验证:登录态拿到了,但 take 接口返回 500(2026-10-06)

用真实浏览器(用户勾选 Allow remote debugging 后,CDP 直连其 Edge,读取 cookie,不复制 profile)拿到
杉果登录态后,做了完整验证:

| 检查 | 结果 |
| --- | --- |
| `GET /epic/game/user-game/get-user-info`(带 Bearer) | **200** —— 返回 id / name / `thirdId`(Epic 账号 id)/ `gameNum` 64 / `freeNum` **63** |
| 杉果侧绑定的 Epic 账号 vs 我们 OAuth 的 `accountId` | **相同**(绑的就是同一个账号) |
| `GET /epic/game/user-game/queryTakeRecordPage` | **200** —— 53 条领取记录(令牌与接口都正常) |
| `POST /epic/game/user-game/take` `{"epicUserId": …}` | **500 Internal Server Error** |
| 加上 `mark_uuid`(query 与 header 各试)、`TDC_itoken`、`clientType`、`gameId`、`productId`、`gameIds`、`id`、`type` 共 8 种 body 形状 | **全部 500** |
| 在真实浏览器页面里 `fetch()` 调该接口 | `TypeError: Failed to fetch`(跨域被拒,无法从网页复现) |

**判断**:`take` 的 500 与「参数名/缺字段」无关(否则应是 400 —— 缺 `epicUserId` 时确实是 400)。
更可能是:① 该接口要求 App 侧特有的上下文(客户端签名/设备态),第三方 HTTP 调用直接 500;
② 或杉果侧后端当前故障;③ 或杉果保存的 Epic 授权已失效(绑定时间为 2025-04,`freeNum` 停在 63)。

**决定性的下一步(成本最低)**:让用户在**杉果 App 里手动点一次「Epic 喜加一」领取**。
- App 也失败 → 杉果侧 Epic 集成已坏,这条路作废;
- App 成功 → 说明接口需要 App 特有上下文,要复刻就得先绕过证书固定(抓包),成本明显上升。

## 4.8 反编译 App 的 HTTP 层:为什么第三方调用必然 500(2026-10-06)

用户确认「App 里手动领取成功」后,把 APK 的 dex 用 `jadx` 全量反编译(10,939 个类),直接读它的 HTTP 层:

`AppOkHelper` 的拦截器链:`HeaderInterceptor` → `ChangeUrlIntercepter` → `RefreshTokenInterceptor`。

| 类 | 作用 | 结论 |
| --- | --- | --- |
| `HeaderInterceptor` | 只加两个头:`Authorization: Bearer <token>` 与 `Rcode` | **`Rcode` 为空时根本不会加**(源码里 `if (!getRCode().isEmpty())`)→ 不是我们缺头 |
| `ChangeUrlIntercepter` | 按 `url_name` 请求头重写目标 host(该头在发出前被移除) | host 由 JS 层指定,与我们直接请求 `api.sonkwo.cn` 一致 |
| `RefreshTokenInterceptor` | 401 时用 refresh token 换新 token 并重放 | 与我们的 500 无关(我们不是 401) |

**`Rcode` 的来源**(顺带查清):`SonkwoRouter.Callback.onUrlRCodeFound(url)` —— 它是 App 从**某个 URL 里解析出来**的会话风险码,
变化时会触发 `LogOutModule.sendEvent("3")`(强制重登)。JS 侧通过 `getRcode` / `saveRcode` 读写。

**实测**:带上 `url_name`、`mark_uuid`、`TDC_itoken`,再加 9 种 body 形状(`epicUserId` / `offerId`+`namespace` /
`activityId` / `couponId` / `freeGameId` …)—— **全部 500**;缺 `epicUserId` 时才是 400。

**结论**:第三方 HTTP 调用该接口**稳定 500**,而 App 能成功。差异不在请求头(已逐行核对),最可能是:
服务端对该接口有额外的**客户端/设备态风控**(或 `TDC` 会话),也可能是后端自身缺陷。
复刻需要先绕过证书固定抓真实请求(Frida/改包),投入产出比明显变差。

**至此建议**:① 手动在 App 里点(零成本,已验证可用);② 自动化改走**本机住宅 IP + 可见浏览器**;
③ 若仍要杉果路线,再考虑改包抓包。

## 6. 未解问题(需抓包/实测)

1. 杉果 App「Epic 喜加一」点击领取后,实际请求的**域名/路径/鉴权**是什么?是杉果后端代领,还是 App 内 Epic webview?
2. 该请求是否**可脱离 App 复刻**(是否需要设备指纹/签名/时间戳/HMAC)?
3. 领取时是否出现 Epic hCaptcha 或杉果自身的验证码?
4. 领取是否要求 Epic 账号**地区为 CN**(杉果是大陆站,前端注释「iOS 设备过滤 Android 端数据」,疑似分端/分地区逻辑)?
5. 当前杉果**签到**是否已加验证码(旧 HAR 是 2021/2023 的,需现状实测)。
6. 杉果「果豆」与 `epicOneClick` 任务的奖励规则(是否影响领取次数/资格)。

---

## 7. 搜索过程与关键词(证明查过,不是没查)

- GitHub(`gh search`,已鉴权 Zzz210s):
  - repos:`sonkwo`(11 条,详见第 3 节)、`杉果`、`杉果 领取`(空)、`sonkwo epic`(空)
  - code:`sonkwo`(含 `auth.sonkwo.com`、`.har`)、`杉果`、`sonkwo epic`(空)、`epic/game/freeList`(空)、`api.sonkwo.cn`(空)、`com.sonkwoapp`(仅包名收录)、`sonkwoapp`(同)
  - issues:`杉果`、`sonkwo`(找到 qd-today 的杉果签到模板 issue、IsThereAnyDeal 的 sonkwo 商店支持 issue)
- Gitee:`https://gitee.com/api/v5/search/repositories?q=杉果|sonkwo` → `[]`;网页 `https://search.gitee.com/?q=杉果` 纯 JS 无法解析 → **未找到证据**
- 官网一手抓取:`www.sonkwo.cn`(首页/账号页/robots/epic 深链)、`api.sonkwo.cn/epic/game/freeList`(实测 200)、前端 bundle(静态 chunk + 自带 `AGENTS` 文档)
- 搜索引擎:必应(连续把「杉果」切词成「杉(树)」,结果全是植物学,不可用)、DuckDuckGo HTML(间歇可用,查到「epic喜加15可以用杉果领取吗」抖音短视频标题、CSDN「Epic 免费领取攻略」等二手线索后即被限流)、CSDN 站内搜索(`杉果 epic`、`杉果 脚本` 均无相关)、搜狗/百度(百度返回「百度安全验证」,搜狗需 JS)
- B 站搜索 API:`杉果 epic`、`杉果 领取`、`杉果 喜加一`、`杉果 白嫖`(找到「Steam/Epic促销怎么参加,教你手机一键领限免」「为啥杉果上面显示已领取但是没有激活码?」等二手线索,但都无脚本代码)
- 二手来源(仅指路,结论已回到一手代码/接口):CSDN、B 站、抖音、应用宝 App 详情页

**二手来源里没有一条给出「杉果 Epic 领取」的代码或接口**,一手来源(杉果官方前端 + 其自带 AGENTS 文档 + 杉果公开 API)才是本文结论的依据。
