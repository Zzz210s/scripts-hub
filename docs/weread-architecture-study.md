# 微信读书脚本研学:它为什么能做成(2026-10-06)

对象:`proj-weread-signin`(本机权威工作区(本地 git 仓库,不入快照),发布在 `Zzz210s/scripts-hub`)。
目的:用户要求把它"完全研学一遍",看它的**混合通道**模式能否迁移到杉果那条路。

---

## 1. 结构:三条通道,各有凭据与续期

| 通道 | 实现 | 凭据 | 寿命 / 续期 |
| --- | --- | --- | --- |
| **网页** | `src/auth.js` + `secrets/read-request.curl` | 浏览器抓来的一条 cURL(cookie:`wr_skey` / `wr_rt` / `wr_vid` / `wr_pf`) | `wr_skey` **1.5 小时**,`wr_rt` / `wr_vid` / `wr_pf` **360 天(滚动)**;`POST https://weread.qq.com/web/login/renewal` 续期,把 `Set-Cookie` 合并后**原子回写进 cURL 文件** |
| **App** | `src/app-auth.js` + `src/app-login.js` | `secrets/app-token.json`(短期)、`secrets/app-credentials.json`(扫码得到的长期) | accessToken 实测约 **2 小时**;`callWithRefresh` 撞 401/-2012 自动强制重换 |
| **官方只读** | `src/stats.js` | `secrets/weread-api-key.txt` | `POST https://i.weread.qq.com/api/agent/gateway`(`api_name: /readdata/detail`)→ 回读当天秒数 |

## 2. App 通道的关键细节(决定它可不可复刻)

```text
POST https://i.weread.qq.com/login
body: { deviceId, deviceName, inBackground, kickType, random, refCgi,
        refreshToken, signature, timestamp, trackId, deviceType }
signature = sha256(timestamp + deviceId + random)      ← 没有密钥!
设备头:baseapi / appver / basever / osver / channelId / User-Agent(电纸书 BOOX)
```

- **签名里没有密钥**:任何人都能算 → 服务端只做完整性校验,不做客户端身份校验。
- **协议事实来自开源项目** `teng-lin/weread-omni`(MIT,第三方电纸书客户端)的 `docs/endpoints.md`、
  `src/auth/token.ts`、`src/auth/qrlogin.ts` → 我们**照事实实现**,不需要抓 App 的包。
- **长期凭据来自官方登录**:`app-login.js` 走微信开放平台扫码(`/wxticket` → `qrconnect` → 轮询
  `wx_errcode 408/404/405/402/403` → `POST /login`),拿到的 refreshToken 长期有效。
- **网页 cookie 可换 App token**:`readWebCredentials()` 从 cURL 里取 `wr_vid` + `wr_rt` 直接换票。

## 3. 它能成的三个条件

1. **网页端有等价的、可续期的入口**(`renewal` 接口 + 360 天滚动 cookie)→ 长期凭据拿得到;
2. **App 协议已被公开**(开源项目)→ 不用抓包、不用绕客户端校验;
3. **服务端接受第三方实现**(签名无密钥、无设备指纹风控)→ 照协议发就能通。

三条同时成立,脚本才有生存空间。缺任何一条,都会退化成"对抗"而不是"复刻"。

## 4. 工程做法(值得抄的 5 条)

1. **凭据分层**:长期(360 天)+ 短期(2 小时)+ 自动续期 + 原子回写(失败不留半截文件)。
2. **回读校验**:不信"请求成功"(网页阅读接口返回空 JSON),一律回查官方口径
   (`/readdata/detail` 的当天秒数),涨了才算数。
3. **协议事实外部化**:逆向出来的协议写成源码注释并标注来源(仓库/文件),后续能追。
4. **通知分级**:只有"需要你处理"(`credential-invalid` / `stats-unavailable`)才推送,其余静默。
5. **通道互为备份**:网页通道坏了 App 通道还在,反之亦然。

## 5. 对照杉果:三个条件都不成立

| 条件 | 微信读书 | 杉果 |
| --- | --- | --- |
| 网页端有等价入口 | 有(`renewal` + 阅读接口) | **没有**(网页只有展示清单,领取按钮都没有) |
| App 协议已公开 | 有(`weread-omni`) | **没有**(GitHub/Gitee 只有签到、提 Key、爬虫脚本) |
| 服务端接受第三方 | 接受(签名无密钥) | **拒绝**(同一请求 App 成功、外部调用 500) |

结论:**"照微信读书的模式复刻杉果"走不通** —— 杉果缺的不是抓包手段,而是上面三个前提。
要突破只能走"对抗"(改包绕证书固定、复刻设备态风控),收益与风险都不划算。

## 6. 迁移到我们自己的自动化(与杉果无关)

- **Epic 领取**可以照搬第 4 节第 2 条:用 entitlement API 回读校验,而不是信任页面文案。
- **凭据分层**已在 Epic 上成立(access 约 2 小时续期、refresh 约 23 天滚动),保持。
- **通知分级**已在三个程序上统一(只有"需要你处理"才推),保持。
