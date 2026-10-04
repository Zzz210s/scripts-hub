# Epic 登录态:调研与实现

本项目从「人工登录一次,靠浏览器 profile 里的会话 cookie」升级为**可自己续命的持久登录**:
跑一次设备授权登录,程序拿到可长期使用的 `refresh_token`,之后每次运行自动续期并把登录态注入
Playwright 的持久化 profile。人只在令牌被真正吊销时才需要再登录一次。

本文把**事实**(有可核对来源)与**推测**(没有官方文档、只由成熟项目行为反推)分开标注。
来源列在最后一节,优先用一手代码/官方文档,不用博客转述。

## 结论摘要

| 问题 | 结论 | 性质 |
| --- | --- | --- |
| 哪种授权能拿到长期凭据 | 设备码授权 `device_code` 一次性确认后拿到 access + refresh token;刷新令牌可长期滚动 | 事实 |
| access token 寿命 | EOS 官方称约 2 小时;web 侧 `EPIC_BEARER_TOKEN` cookie 是 8 小时 | 事实 |
| refresh token 寿命 | 响应里带 `refresh_expires_at`;启动器客户端实测约 23 天,每次刷新滚动延长 | 事实 + 实测 |
| 刷新是否轮换 | 每次刷新都返回新的 `refresh_token`,客户端必须把新的存回去 | 事实(返回新值)/ 推测(旧值立即作废) |
| 会话注入靠什么 | 写 `EPIC_BEARER_TOKEN` cookie = access token,域 `.epicgames.com` 等;站点自行换内部 EG1 cookie | 事实 |
| 最理想落点 | `device_code` → 存 `refresh_token` → 每次运行前自动 `refresh_token` 续期 | 本项目选择 |
| `device_auth`(deviceId+secret) | 永不过期,只有用户改密等操作才失效;但**必须已登录才能创建** | 事实 |

## 1. OAuth 端点与授权类型

单一 token 端点,`POST`,`application/x-www-form-urlencoded`,HTTP Basic 头带
`clientId:secret`:

```
https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token
```

支持的 grant(本项目用到的三个加粗):

| grant_type | 用途 | 关键参数 |
| --- | --- | --- |
| `client_credentials` | 只代表客户端,不代表用户 | 无 |
| **`device_code`** | 用户在浏览器确认一次后换用户令牌 | `device_code` |
| **`refresh_token`** | 用刷新令牌续期 | `refresh_token` |
| `exchange_code` | 启动器传给游戏的一次性码,5 分钟过期 | `exchange_code` |
| `device_auth` | deviceId + secret 长期换票,不过自然过期 | `account_id` / `device_id` / `secret` |
| `authorization_code` | EOS 授权码换票 | `code` |

设备授权先要拿**客户端令牌**再取设备码:

```
POST .../account/api/oauth/deviceAuthorization?prompt=login     Authorization: Bearer <client_credentials token>
  -> { user_code, device_code, verification_uri_complete, expires_in, interval }

POST .../account/api/oauth/token
  grant_type=device_code & device_code=<device_code>
  轮询期间返回 errorCode=errors.com.epicgames.account.oauth.authorization_pending
  确认成功后返回完整会话 { access_token, expires_at, refresh_token, refresh_expires_at, account_id, displayName }
```

**客户端凭据**:设备授权需要一个应用客户端。本项目用公开的
`fortniteNewSwitchGameClient`(`98f7e42c2e3a4f86a74eb43fbb41ed39` /
`0a2449a2-001a-451e-afec-3e812901c4d7`),与 `claabs/epicgames-freegames-node` 的默认值一致。
这是**应用凭据**(公开代码里到处都有),不是用户秘密;用户秘密只有 `secrets/epic-tokens.json`。

注意区分:网上常见的 `eg1` 是 legendary 用的 `launcherAppClient2`
(`34a02cf8f4414e29b15921876da36f9a`),`token_type=eg1` 只是令牌类型标记,不等于某个 client_id。

## 2. refresh token 的寿命与轮换

**事实**:刷新响应是**完整会话**,同时返回新的 `access_token` 与 `refresh_token`,以及
`refresh_expires_in` / `refresh_expires_at`。成熟项目(legendary、claabs)都把响应的新
`refresh_token` 覆盖存回本地。

**实测**(非官方):一个启动器会话里 `refresh_expires` 为 `1987200` 秒,约 **23 天**;
`access_token` 的 `expires_in` 为 `28800` 秒。web 侧 `EPIC_BEARER_TOKEN` cookie 的
`Max-Age` 同样是 `28800`;`rememberMe: true` 时另有 `EPIC_SSO_RM` / `EPIC_SESSION_AP`
两个 30 天的 cookie。

**推测**(没有官方文档):刷新是**轮换制**,用过一次的旧 `refresh_token` 可能被作废,所以
必须把新值原子写回;若并发用了同一个旧值,后到的那次会被拒。
`MixV2/EpicResearch` 的 issue #130 报告过刷新令牌「随机失效」,因此把
`errors.com.epicgames.account.auth_token.invalid_refresh_token` 当作**只能重新登录**的信号,
而不是当网络错误去重试。

只要在刷新令牌过期前**至少刷新一次**(本项目每次运行都会刷新),寿命就一路滚动延长,
不需要人再登录。

## 3. 会话注入:Playwright 怎么变回登录态

**事实**:Epic 的网页把登录态放在 `EPIC_BEARER_TOKEN` cookie 里。把 OAuth 的
`access_token` 原样写成这个 cookie 即可:

```
name=EPIC_BEARER_TOKEN   value=<access_token,含 eg1~ 前缀>
domain=.epicgames.com    path=/    secure    httpOnly    sameSite=Lax
```

`claabs/epicgames-freegames-node` 在 `src/puppet/base.ts` 里就是这么做的:对
`.epicgames.com` / `.fortnite.com` / `.unrealengine.com` / `.twinmotion.com` 四个域各写一份,
然后访问商店页,让页面自己把它换成内部 EG1 cookie。`woctezuma/egs-15DaysofGames` 的
`src/auth_utils.py` 也直接 `cookies = {"EPIC_BEARER_TOKEN": access_token}`。

**本项目的做法**:不去改 `vendor/` 里的上游脚本(那是逐字节快照)。注入分两步——
先用 patchright 打开引擎同一个持久化 `userDataDir`、`addCookies`、关闭,让 cookie 落进
profile;随后引擎启动读到的就是已登录的 profile。代价是多一次极短的浏览器启动,只在有
token 且需要注入时才发生;注入失败自动退化为「用 profile 里既有的会话」。

## 4. 设备授权能否得到长期 refresh_token

**能**。`device_code` 授权成功后返回的就是普通用户会话,包含 `refresh_token` 与
`refresh_expires_at`,与 `authorization_code` / `exchange_code` 得到的是同一类东西。
这正是最理想的落点:**人在浏览器确认一次,之后纯自动**。

两条它的边界要记住(都是事实):

- `device_code` 的确认链接有时效(`expires_in`,通常几分钟到十几分钟),过期要重新发起。
- 刷新令牌被服务端吊销时(改密码、在账号安全页撤销设备、Epic 侧风控),只能用
  `refresh_token` 之外的入口重新登录——对本项目就是再跑一次 `node src/cli.js login`。

`device_auth`(accountId + deviceId + secret)理论上更持久(不过期,只有用户操作才失效),
但它**要求先有有效 access token 才能创建**;想彻底自动化仍需先登录一次。本项目因此把
`device_code` 作为入口,不额外引入 `device_auth` 的凭据面。

## 5. 本项目实现

| 文件 | 职责 |
| --- | --- |
| `src/oauth.js` | OAuth 端点、四个授权函数、失败分类(`pending` / `revoked` / `network` / `invalid`) |
| `src/tokens.js` | `secrets/epic-tokens.json` 读写、过期判定、掩码、状态摘要 |
| `src/auth.js` | `ensureSession`:未过期直接用;过期自动刷新(网络退避重试);吊销则要求人工登录 |
| `src/inject.js` | 组装 `EPIC_BEARER_TOKEN` cookie,写进持久化 profile;失败退化 |
| `src/login.js` | `deviceLogin`(设备授权)与 `profileLogin`(浏览器退路) |

`ensureSession` 的返回值决定了运行编排:

- `{ ok:true, mode:'profile' }` —— 没有 token 文件,继续用浏览器 profile 的既有登录态(向后兼容)。
- `{ ok:true, mode:'token'|'refreshed' }` —— 用 token,已尝试注入;注入失败只记警告。
- `{ ok:false, needsLogin:true }` —— 刷新被吊销,推 `action` 类消息,让人跑 `login`。
- `{ ok:false, network:true }` —— 网络类失败(已退避重试),推可重试的提示。

token 文件不写进仓库(`.gitignore` 已含 `secrets/`),写盘时尽量 `chmod 600`;
日志与通知里 token 一律掩码(`maskToken` 只留前后各几位)。

## 6. 多久需要重新登录

正常情况**不需要再登录**:每次运行都会刷新一次 access token,刷新令牌的寿命随之滚动。
只有下列情况要重跑 `node src/cli.js login`:

- 刷新返回 `invalid_refresh_token` 或 401/403(被吊销);
- `refresh_token` 已过 `refresh_expires_at`(太久没跑,比如超过实测的约 23 天);
- 改过 Epic 密码或在账号安全页撤销了登录。

判断方法:`node src/cli.js auth` 打印 access / refresh 的到期时间与有效性;
`node src/cli.js login` 输出的 `登录成功:<账号>` 表示新的令牌已落盘。

## 7. 未验证部分(要真账号才能确认)

- 注入的 `EPIC_BEARER_TOKEN` cookie 对本账号在 `store.epicgames.com` 上确实恢复了登录态;
- `fortniteNewSwitchGameClient` 的 `device_code` 流程当前仍然可用;
- 刷新令牌轮换的确切语义(旧值是否立即失效)与精确寿命;
- 领取链路本身仍可能被 hCaptcha 挡住——那是另一条退化路径,与登录态无关。

## 来源

一手(代码/官方文档):

- MixV2/EpicResearch:`docs/auth/grant_types/{device_code,device_auth,refresh_token,exchange_code}.md`、
  `docs/auth/auth_clients.md`、`docs/account/endpoints/get_device_authorization.md`
  <https://github.com/MixV2/EpicResearch>
- claabs/epicgames-freegames-node:`src/device-login.ts`(设备授权与刷新)、
  `src/common/constants.ts`(端点)、`src/common/config/classes.ts`(默认客户端)、
  `src/puppet/base.ts`(cookie 注入)、`Notes.md`(cookie Max-Age)
  <https://github.com/claabs/epicgames-freegames-node>
- derrod/legendary:`legendary/api/egs.py`(`launcherAppClient2` 与 `token_type=eg1`)
  <https://github.com/derrod/legendary>
- woctezuma/egs-15DaysofGames:`src/auth_utils.py`(`EPIC_BEARER_TOKEN` = access_token)
  <https://github.com/woctezuma/egs-15DaysofGames>
- Epic Online Services 官方:`Auth Web APIs`(access token 约 2 小时、token 端点)、
  `Auth Interface Reference`(持久化登录/长期刷新令牌、错误码)
  <https://dev.epicgames.com/docs/web-api-ref/authentication>

旁证(实测/issue,非官方):

- lutris/lutris issue #4783:一个令牌 JSON 里 `expires_in=28800`、`refresh_expires=1987200`
  <https://github.com/lutris/lutris/issues/4783>
- legendary-gl/legendary discussion #580:`invalid_refresh_token` 只能重新登录
  <https://github.com/legendary-gl/legendary/discussions/580>
- MixV2/EpicResearch issue #130:刷新令牌偶发失效
  <https://github.com/MixV2/EpicResearch/issues/130>
