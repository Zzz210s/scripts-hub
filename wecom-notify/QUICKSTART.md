# QUICKSTART — wecom-notify

企业微信群机器人通知 CLI 与库,**零运行时依赖**。本目录是它在仓库里的唯一副本。

## 前置条件

- Node.js >= 18(用内置 `fetch`),没有别的依赖
- 要真发消息时:一个企业微信群机器人 webhook 地址(获取方法见 [README](README.md#配置-webhook))

## 三条命令

```bash
cd wecom-notify
npm test                     # 8 条用例,离线,不需要 webhook
node cli.js --dry-run "自检"  # 只打印将发送的内容,不发起请求
```

要注册全局命令 `wecom-notify`(可选):

```bash
sh install.sh                # 检查 Node 版本 -> npm link -> 验证命令可用
```

一次把上面都跑一遍(含凭据检查):

```bash
bash ../scripts/setup-wecom-notify.sh          # 只自检
bash ../scripts/setup-wecom-notify.sh --install # 自检并注册全局命令
```

## 需要填的凭据

webhook 地址按优先级解析,任选一种即可(都已被 gitignore 覆盖,不会入库):

| 顺序 | 来源 |
| --- | --- |
| 1 | `--webhook <url>` |
| 2 | 环境变量 `WECOM_WEBHOOK_URL` |
| 3 | `--webhook-file <path>` 或 `WECOM_WEBHOOK_FILE` |
| 4 | `./wecom-webhook.txt`(文件内首个非注释行) |

```bash
cp wecom-webhook.txt.example wecom-webhook.txt   # 再粘真实地址
```

## 怎么验证跑通了

1. `npm test` 全绿(8 条)
2. `node cli.js --dry-run "自检"` 打印出脱敏后的目标地址与消息体
3. 配好 webhook 后 `node cli.js --check` 会真发一条测试消息到群里

## 常见失败

| 现象 | 处置 |
| --- | --- |
| `未找到 webhook 地址` | 四个来源都没命中;`wecom-webhook.txt` 必须在**当前工作目录** |
| `errcode=93000` | key 无效或机器人已被移出群;重新复制地址 |
| `errcode=45009` | 触发频率限制(约 20 条/分钟);降频或合并消息 |
| 消息以 `...` 结尾 | 文本超 2048 字节 / markdown 超 4096 字节的预期截断 |
| `npm link` 报权限错 | 改用 `node cli.js`(不需要全局命令) |
