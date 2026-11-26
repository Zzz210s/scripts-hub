# 接口与风控实测记录(2026-11-25 / 26)

页面一改版,这份记录里的 resId 就可能过期。下面的复现命令能在几分钟内重新量一遍。

## 1. 结论速查

| 能力 | 走什么 | 状态 |
| --- | --- | --- |
| 读豆数 | `GET h5.ele.me/restapi/biz.svip_core/v1/foodie/homepage` | 可用,要登录态 |
| 读任务列表 | `mtop.alibaba.svip.langrisser.query`,resId **224166** | 可用 |
| 领取任务 | `mtop.alibaba.svip.langrisser.act` | **纯 HTTP 一律 100012 风控用户** |
| 页面内点「领取」 | 真浏览器 + 真鼠标事件 | 本程序采用的路径 |

## 2. 网关:选错就撞验证

同样是带签名的 mtop 请求:

- `https://guide-acs.m.taobao.com/h5/...` → `FAIL_SYS_USER_VALIDATE` + `RGV587_ERROR::SM::哎哟喂,被挤爆啦`
  (跳 `_____tmd_____/punish?x5secdata=...`,即滑块页)
- `https://waimai-guide.ele.me/h5/...` → `SUCCESS::调用成功`

套用老教程的网关会直接卡在第一步。

## 3. resId 对照

`resName` 会写在响应的 `data.data.<resId>.trackParams.resName` 里,据此认身份:

| resId | resName | 说明 |
| --- | --- | --- |
| 224166 | 赚豆2.0-逛逛任务-查询 | 真正的任务列表(每天几条「去逛逛」类任务) |
| 223166 | 赚豆2.0-逛逛任务-领取 | 老的领取入口 |
| 223636 | 赚豆2.1-行业任务-查询 | 常为空 |
| 224659 | 赚豆2.1-行业任务-领取 | 新版页面领取入口 |

任务对象关键字段:`missionDefId`、`missionCollectionId`(常见 36)、`missionXId`、`asac`
(固定 `2A21119A45TTVAEXP40N7N`)、`missionType`(`SIMPLESIGNIN`)、`rewardStatus`
(`TODO` 待领 / 其它已领)、`status`(`FINISH` 表示任务已完成、等着领奖)。

## 4. mtop 签名与令牌

```
sign = md5(token_part + "&" + t + "&" + "12574478" + "&" + data)
token_part = _m_h5_tk 里下划线之前那段
```

- `t` 是毫秒时间戳,`appKey` 固定 `12574478`,`data` 是 JSON 字符串原文。
- 令牌过期时返回 `FAIL_SYS_TOKEN_EXOIRED`,**同一次响应**的 `Set-Cookie` 里给出新的
  `_m_h5_tk` / `_m_h5_tk_enc`;改 cookie 后重签重放即可,最多重试三次。
- 坑:自己拼 cookie 串时,`Set-Cookie` 里空值(服务端删 cookie)不能拿来覆盖非空值,否则令牌变空串。

## 5. 风控实测(为什么最后改走页面点击)

| 场景 | 结果 |
| --- | --- |
| 机房 IP(腾讯云北京)HTTP 领取 | `msgCode 100012 / 风控用户`,豆数不变 |
| 家宽 IP HTTP 领取 | 同上 |
| 老形态 `resId 223166` + `extra{missionDefId,missionCollectionId,missionType,asac,missionXId}` | 同上 |
| 新形态 `resId 224659` + `extra{missionCollectionId,missionId}` | 同上 |
| 页面注入 cookie 后由页面内点击 | 待任务出现时验证(2026-11-26 当天任务列表为空) |
| 页面加载后的豆数读取(无头 Chromium,机房 IP) | 正常,2213 豆 |

任务页加载时会向 `https://ynuf.aliapp.org/wu.json` 与 `service/um.json` 取设备指纹(umid),
这是纯 HTTP 复现不了的一层。结论:让页面自己发请求,别自己做。

## 6. 浏览器侧几个必须记住的坑

1. **cookie 要按域灌**,不能只按 `https://h5.ele.me` 灌。按 url 灌时页面能用,但它发往
   `waimai-guide.ele.me` 的 mtop 请求带不上这些 cookie,页面直接显示「未登录去登录」。
   正确做法:`Network.setCookie` 带 `domain=.ele.me` 与 `.taobao.com`。
2. **不给 `expires` 的 cookie 是会话 cookie**,只在内存里,关浏览器即失。导出的 jar 没有过期
   时间,灌的时候必须补(这里补 30 天),否则 `seed` 完了下一轮还是未登录。
3. **必须优雅关闭**(`Browser.close`),硬 kill 会让 Chrome 来不及把 cookie 落盘。
4. **定位要授权**:`Emulation.setGeolocationOverride` 之外还要
   `Browser.grantPermissions{permissions:['geolocation']}`,否则页面显示「无法获取位置信息」。
5. **点按钮用真输入事件**(`Input.dispatchMouseEvent`),`element.click()` 不算数。

## 7. 重新量一遍(页面改版时)

```bash
# 1) 页面现在发哪些请求(注入已有 cookie,不必重登)
COOKIE_FILE=secrets/cookie-a1.txt node scripts/windows/capture-api.mjs

# 2) 页面长什么样、有哪些可点按钮
docker compose -f compose.yaml run --rm -T shanggou-run inspect

# 3) 直接试点击链路
docker compose -f compose.yaml run --rm -T shanggou-run claim
```

`inspect` 会打页面文本与按钮列表并留截图:`logs/inspect-<时间>.png`。若文本里出现新的任务
tab(例如「下单任务」),就在这里补一条记录再改 `src/page.js` 的选择器。
