# wecom-notify

企业微信群机器人 webhook 通知 CLI 与库:零依赖,支持文本与 Markdown、按字节截断、网络失败自动重试。

面向无人值守脚本与定时任务的通知需求 —— 消息直接进入企业微信群,不依赖个人号的会话窗口,没有 24 小时时效与条数上限。

## 目录

- [背景](#背景)
- [安装](#安装)
- [官方文档](#官方文档)
- [配置 webhook](#配置-webhook)
- [用法](#用法)
- [API](#api)
- [测试](#测试)
- [常见问题](#常见问题)
- [设计取舍](#设计取舍)
- [本目录约定](#本目录约定)
- [贡献](#贡献)
- [来源与关系](#来源与关系)
- [许可](#许可)

## 背景

这个仓库最初是为一个每日自动运行的任务脚本写通知时抽出来的。那套脚本原本用**微信 ClawBot**(腾讯 iLink 协议)推送结果,实测撞上一个硬限制:

- iLink 的 `context_token` 只在使用者**主动给机器人发过消息后的 24 小时内有效**
- 超过窗口后机器人**主动推送**会被拒:`sendmessage ret=-2 errmsg=prepare failed`
- 同一限制在腾讯官方仓库有对应 issue([openclaw-weixin#202](https://github.com/Tencent/openclaw-weixin/issues/202):"用户 24 小时无主动交互,context_token 直接失效,机器人无法主动推送定时提醒")

对"跑完就通知"这种场景,依赖人工互动不可接受,于是改用**企业微信群机器人 webhook**:同样是腾讯官方、免费,但没有会话窗口、没有条数上限,代价是消息进的是企业微信群而不是个人微信。本目录把这套发送逻辑整理成可复用的 CLI 与库。

## 安装

前置要求:Node.js 18 或更高版本(依赖全局 `fetch`)。无任何第三方运行时依赖。

```bash
# 取出本目录(scripts-hub 仓库里的 wecom-notify/)
git clone https://github.com/Zzz210s/scripts-hub.git
cd scripts-hub/wecom-notify
sh install.sh          # 注册全局命令 wecom-notify;可重复执行(幂等)
```

`install.sh` 做的事:检查 Node 版本 >= 18 -> `npm link` 注册全局命令 -> 验证命令可用 -> 打印 webhook 配置步骤。
本机已执行过该脚本并验证通过(全局命令 `wecom-notify` 可用)。

不使用安装脚本时,也可以直接用 `node cli.js`(无需 npm link):

```bash
node cli.js --help
```

卸载:

```bash
npm unlink -g wecom-notify
```

运行测试:

```bash
npm test
```

## 官方文档

本目录的行为以企业微信官方文档为准,遇到参数、上限、错误码相关问题时先查官方页面:

| 内容 | 官方地址 |
| --- | --- |
| 群机器人「消息推送配置说明」(绑定与发送接口的权威说明) | <https://developer.work.weixin.qq.com/document/path/91770> |
| 企业微信官网(客户端下载、产品说明) | <https://work.weixin.qq.com/> |
| 企业微信开发者中心(接口总目录) | <https://developer.work.weixin.qq.com/> |

官方文档中的体积上限(文本 2048 字节、markdown 4096 字节)、频率上限(约 20 条/分钟)、`errcode` 定义与本目录实现保持一致;官方如有更新,以官方为准并同步本目录。

## 配置 webhook

获取地址:企业微信 App -> 进入目标群 -> 右上角 `...` -> 群机器人 -> 添加机器人 -> 复制 Webhook 地址(官方说明见[官方文档](#官方文档):<https://developer.work.weixin.qq.com/document/path/91770>)。

地址解析优先级(从高到低):

| 顺序 | 来源 | 说明 |
| --- | --- | --- |
| 1 | `--webhook <url>` | 命令行直接给出 |
| 2 | `WECOM_WEBHOOK_URL` | 环境变量 |
| 3 | `--webhook-file <path>` / `WECOM_WEBHOOK_FILE` | 指定文件 |
| 4 | `./wecom-webhook.txt` | 默认文件,文件内首个非注释行生效 |

```bash
cp wecom-webhook.txt.example wecom-webhook.txt
# 编辑 wecom-webhook.txt,粘贴真实地址(该文件已列入 .gitignore)

export WECOM_WEBHOOK_URL='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx'   # 或改用环境变量
```

webhook 地址本身即密钥,请勿提交到版本库;CLI 输出的地址会做脱敏处理(只输出 `key=****`,不泄露任何 key 字符)。

## 用法

```bash
# 发送文本
wecom-notify "构建完成:42 秒"

# 从标准输入读取(适合管道)
tail -n 50 logs/last-run.log | wecom-notify --stdin

# 发送文件内容(超过 2048 字节自动截断)
wecom-notify --file logs/last-run.log

# Markdown 格式(上限 4096 字节)
wecom-notify --markdown "**构建失败** > 详见 \`logs/build.log\`"

# 配置自检(发一条测试消息)
wecom-notify --check

# 只打印将要发送的内容,不发起请求
wecom-notify --dry-run "内容"
```

退出码:`0` 成功,`1` 发送失败,`2` 用法或配置错误(未找到 webhook、内容为空等)。

与定时任务结合(Windows 计划任务里跑一段批处理):

```bat
@echo off
cd /d "%~dp0"
node cli.js --file logs\last-run.log
```

Linux/macOS 的 cron:

```cron
30 8 * * * cd /srv/job && /usr/bin/node cli.js --file logs/last-run.log
```

在 Node 脚本里直接调用:

```js
import fs from 'node:fs'
import { sendWecom } from './src/wecom.js'
import { resolveWebhook } from './src/webhook.js'

const { url } = resolveWebhook()
await sendWecom(fs.readFileSync('logs/last-run.log', 'utf8'), { webhookUrl: url })
```

## API

从 `src/wecom.js` 与 `src/webhook.js` 导出。

| 导出 | 签名 | 说明 |
| --- | --- | --- |
| `sendWecom` | `(text, options) => Promise<object>` | 发送消息。`options`: `webhookUrl`(必填)、`msgtype`(`text` 默认 / `markdown`)、`retries`(默认 2)、`timeoutMs`(默认 10000)、`fetchImpl`、`sleep`、`onRetry(error, attempt)` |
| `clampText` | `(content, maxBytes = 2048) => string` | 按 UTF-8 字节截断,并追加 `...`,不会截断出半个多字节字符 |
| `WecomError` | `class extends Error` | 服务端 `errcode` 非 0 时抛出,错误对象带 `errcode` 字段;这类错误不重试 |
| `resolveWebhook` | `(options) => { url, source }` | 按优先级解析 webhook;失败抛错。`options`: `url`、`file`、`cwd`、`env` |
| `maskWebhook` | `(url) => string` | 脱敏为 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=****`,不泄露任何 key 字符 |
| `isWebhookUrl` | `(value) => boolean` | 校验是否为企业微信发送接口地址 |
| `TEXT_MAX_BYTES` / `MARKDOWN_MAX_BYTES` | `number` | `2048` / `4096` |

重试策略:仅对网络错误与超时重试,指数退避(1s、2s),默认共 3 次尝试;`errcode` 类拒绝立即抛出。

## 测试

```bash
npm test        # node --test,8 个用例:字节截断、地址校验与脱敏、解析优先级、重试、errcode 不重试、空内容拒绝
```

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `errcode=93000` | webhook key 无效,或机器人已从群里移除;重新复制地址 |
| `errcode=45009` | 触发频率限制(群机器人约 20 条/分钟);降低发送频率或合并消息 |
| 消息被截断且以 `...` 结尾 | 文本超过 2048 字节(或 markdown 超过 4096 字节)时的预期行为 |
| `未找到 webhook 地址` | 四种配置来源都没有命中;确认 `wecom-webhook.txt` 是否在**当前工作目录** |
| 只收到文本样式,Markdown 未生效 | 群机器人对 Markdown 支持有限(不支持表格、部分语法);改用纯文本 |

## 设计取舍

- **零依赖**:只用 Node 内置能力,便于在离线或受限环境里部署,也不会因为锁文件更新而失效。
- **文件优先的配置**:无人值守场景一般把 webhook 放在本地文件里,而不是写进命令行(命令行会进入进程列表与日志)。
- **输出脱敏**:所有路径都不打印完整 webhook,日志可以安全留存。
- **发送成功即返回**:不做队列与重试落盘;如果任务本身失败,通知失败不应影响任务退出码(调用方自行忽略本工具的非零退出码即可)。

## 本目录约定

本目录的改动必须遵守以下约定:

1. **官方依据优先**:企业微信通道的绑定、发送能力与限制,一律以官方文档为准 —— 群机器人「消息推送配置说明」<https://developer.work.weixin.qq.com/document/path/91770>。文档中的参数名、体积上限(文本 2048 字节、markdown 4096 字节)、频率上限(约 20 条/分钟)必须与本目录实现一致;官方变更时,以官方为准并同步代码与 README(见[官方文档](#官方文档))。
2. **安装入口统一**:安装只走仓库根目录的 `install.sh`(已在本机执行并验证,全局命令 `wecom-notify` 可用)。不要再新增其它安装脚本,也不要手工拷贝文件到系统目录。
3. **密钥不入库**:webhook 地址只允许存在于本地文件或环境变量中,仓库内只能出现 `wecom-webhook.txt.example`;任何输出都必须经过 `maskWebhook` 脱敏(不泄露 key 的任何字符)。
4. **零运行时依赖**:保持无第三方依赖;确需新增依赖时,必须在说明里给出理由。
5. **改动带测试**:提交前 `npm test` 必须全绿;单文件不超过 200 行。
6. **文档为中文**:README 与注释使用简体中文(与 `microsoft-rewards/` 一致),不使用 emoji。

## 贡献

欢迎提 issue 或 PR。改动请附带测试(`npm test`),并保持零运行时依赖。

## 来源与关系

本目录原为独立私有仓库 `Zzz210s/wecom-notify`,2026-10-04 并入本仓库(scripts-hub)。并入后:

- **权威实现在这里**:`src/wecom.js` + `src/webhook.js` + `cli.js`,是本仓库里功能最完整的
  企业微信发送实现(文本与 Markdown、超时、指数退避重试、webhook 解析与脱敏)。
- **与 `microsoft-rewards/wechat-bridge/` 的关系**:那是**另一份独立实现**
  (`lib/wecom.js` + `lib/channels.js`,只发文本、无重试),不是本目录的副本,也不 import 本目录 ——
  两边代码相近但各自维护。wechat-bridge 面向「微软积分跑完发一条结果」这一固定场景;本目录是通用
  CLI/库,面向任意脚本。
- **与 `weread-signin/` 的关系**:微信读书的发送逻辑同样是自己一份
  (`weread-signin/src/notify.js`,带密钥脱敏与退避重试),与本目录也没有 import 关系。
- **现状与取舍**:三份实现协议相同、细节各有取舍,尚未收敛;本次合并只做归档与说明,不改动两个
  程序里的代码。若以后要收敛,本目录是候选的公共底座。

## 许可

MIT — 详见 [LICENSE](LICENSE)。
