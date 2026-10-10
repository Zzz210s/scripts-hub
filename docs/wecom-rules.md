# 企业微信发送规则(权威)

**这是规则文档,不是库。** 企业微信发送的实现由各项目自己持有,互不 import;本文只把
「发送层必须遵守什么」写死下来,作为唯一权威。谁改了发送行为,先改本文,再同步所有实现,
最后跑漂移检测。

面向的对象是**无人值守脚本的通知**:消息进企业微信群机器人,不依赖个人号的会话窗口,
没有 24 小时时效限制。

## 1. 实现位置与消息时机

| 项目 | 实现文件 | 发什么 | 什么时候发 |
| --- | --- | --- | --- |
| 微软积分 | `proj-microsoft-rewards/wechat-bridge/lib/wecom.js`(分发在 `lib/channels.js`,排版在 `lib/report.js`、`lib/start.js`、`lib/skip.js`) | `start` / `result` / `skip` / `action` | 每次运行 |
| 微信读书签到 | `proj-weread-signin/src/notify.js`(策略在 `src/notify-policy.js`,发送时机在 `src/run-notice.js`、`src/run.js`) | `start` / `result` / `skip` / `action` | 每次运行 |
| Epic 限免领取 | `proj-epic-free-games/src/notify.js`(策略在 `src/policy.js`,文案在 `src/messages.js`,发送时机在 `src/run.js`) | `start` / `result` / `skip` / `action` | 探测到当期还有没领过的免费游戏时 |
| B站任务 | `proj-bilibili-tasks/src/notify.js`(策略在 `src/policy.js`,文案在 `src/messages.js`,发送时机在 `src/run.js`) | `start` / `result` / `skip` / `action` | 守卫通过后每次运行;`action` 只在 cookie 失效或扫码登录时发 |

四份实现各自内嵌**同一块** `wecom-core`(字节截断、超时、重试、`errcode` 处理),
由 `scripts/check-wecom-drift.mjs` 锁住逐字节一致。差异只允许出现在外层
(消息排版、webhook 读取、返回形状)。消息类型、文案与频率的表见
[notification-convention.md](notification-convention.md)。

## 2. 接口与形态

- 地址:`POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<KEY>`。
  `key` 就是密钥,只允许存在于本地文件或环境变量;任何日志与输出都必须脱敏为 `key=****`。
- 请求头:`Content-Type: application/json`。
- 文本消息体:`{"msgtype":"text","text":{"content":"..."}}`。
- Markdown 消息体:`{"msgtype":"markdown","markdown":{"content":"..."}}`。
- 成功:HTTP 200 且 `{"errcode":0,"errmsg":"ok"}`。HTTP 非 2xx 或 `errcode != 0` 都算失败。

官方文档(参数、上限、错误码的最终依据):群机器人「消息推送配置说明」
<https://developer.work.weixin.qq.com/document/path/91770>。官方更新时以官方为准,并同步本文与实现。

## 3. 字节上限与截断

- **正文上限 2048 字节**(`msgtype: text`),**markdown 字段上限 4096 字节**,按 UTF-8 计
  (一个常用汉字 3 字节)。两个上限不要混用。
- 必须**按字节安全截断**,不能把多字节字符切一半,也不能让截断后的结果超过上限。
- 正确做法:预留 3 字节给结尾的 `...` → 按字节取到 `maxBytes - 3` → 解码时末尾可能产生
  U+FFFD 占位符,去掉它 → 再补 `...`。结果 `<= maxBytes`。
- **历史坑**:早先的实现按字符串长度(`.length`,UTF-16 码元)截断,或先截满 `maxBytes` 再补
  `...`,结果会到 `maxBytes + 3`(实测超到 2049 字节被服务端拒)。现在的 `clampText` 已按
  上面的做法修好,改这块时不要退回旧写法。
- 未超限时原样返回,不做任何改写;超限才截断并以 `...` 结尾。

## 4. 超时与重试

- **超时 10 秒**,用 `AbortController` 中止;超时按可重试失败处理。
- **可重试**:网络错误、超时、HTTP 非 2xx、限流 `errcode=45009`。
- **重试节奏**:默认重试 2 次(共 3 次尝试),指数退避 `1s → 2s`;每次重试前调 `onRetry` 记录。
- **不重试**:除 45009 以外的任何 `errcode != 0`(服务端明确拒绝,重试没有意义)。
- 重试次数可由调用方用 `retries` 覆盖;`sleep`、`fetchImpl` 可注入,便于测试。

## 5. errcode 处理

| errcode | 含义 | 处理 |
| --- | --- | --- |
| `0` | 成功 | 正常返回 |
| `45009` | 接口调用超过限制(限流) | **可重试**:指数退避后再发;同时应检查发送频率 |
| `93000` | webhook key 无效,或机器人已被移出群 | **不重试**:重试无用,视为**需要人工处理**的事件 |
| `93004` | 机器人已被禁用 | **不重试**:重试无用,视为**需要人工处理**的事件 |
| 其它非 0 | 其它服务端拒绝 | **不重试**:抛出带 `errcode` 的错误并写日志;反复出现需人工看 |

判断原则只有一条:**重试能不能改变结果**。限流是临时的,退避后可成;其余非 0 是配置、权限或
参数问题,重试只会白等,必须让日志和通知把 `errcode` 与 `errmsg` 带到人眼前。发送实现抛出的
错误对象带 `errcode` 字段,调用方据此区分。

## 6. 发送频率

- 企业微信群机器人的上限约为**每机器人 20 条/分钟**;超过返回 `45009`。
- 各项目的节流约定(详见 notification-convention.md):
  - 一次运行最多**两条**(`start` + `result`);
  - `skip` 同一天同一种原因最多一条,「不需要人管」的那些只写日志、不推送;
  - `action` 每次都发,不受限制。
- 频率是设计约束,不是靠重试兜底:能合并就合并,不要在循环里逐条发。`45009` 出现时应先降频。

## 7. 文案硬规则

- 不用圆括号;补充说明一律用 ` · ` 分隔。
- 不用 emoji。
- 标题四段式:`<程序名> · <账号或账号数> · <日期> · <动作>`。
- 单条消息 UTF-8 不超过 2048 字节;发送层会截断,但内容层应先控制长度,不要依赖截断。
- 完整规则与模板见 [notification-convention.md](notification-convention.md)。

## 8. 一致性要求

- 各实现的 `wecom-core` 块必须**逐字节一致**;改任何一处,都要把整块同步到其余各处。
  块内有一行注释只列了最早的两份实现(那两处是生成快照,不能就地改);实际比对的文件清单
  以 `scripts/check-wecom-drift.mjs` 的 `FILES` 为准。
- 提交前跑漂移检测:

  ```bash
  node scripts/check-wecom-drift.mjs            # 不一致退出 1
  node scripts/check-wecom-drift.mjs --verbose  # 打印各块大小与首个差异位置
  ```

- 三份实现里,`proj-microsoft-rewards/` 来自 `%REWARDS_DIR%`、`proj-weread-signin/` 来自 `%WEREAD_DIR%`,
  两者都是**生成快照**;`proj-epic-free-games/` 的权威副本就在本仓库里。改发送核心要先改共享核心的权威来源
  (两份快照要改各自的工作区),再跑 `scripts/sync-microsoft-rewards.sh` / `scripts/sync-weread-signin.sh`
  发布,直接改快照会被下次同步覆盖。工作模型见 [workspace-model.md](workspace-model.md)。

## Key points (English)

- Rules, not a library: each project keeps its own sender; no cross-project import.
- `POST .../webhook/send?key=...`; `text` content limit 2048 bytes, `markdown` field limit 4096.
- Truncate on UTF-8 byte boundaries, reserve 3 bytes for `...`; never exceed the limit.
- Timeout 10s; retry network/timeout/HTTP errors and `errcode=45009` with exponential backoff
  (1s, 2s); never retry other errcodes. `93000`/`93004` mean manual action is required.
- Rate limit is about 20 messages per minute per robot; a run sends at most two messages.
- The `wecom-core` block must stay byte-identical across implementations; run
  `node scripts/check-wecom-drift.mjs`.
