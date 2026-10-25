# 企业微信智能机器人通知中继

把「企业微信智能机器人（API 模式 + 长连接）」包装成本机的 HTTP 通知端点，用来**替代群机器人 webhook**。

## 为什么需要它

群机器人 webhook 是一串 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`，直接 POST 就能推消息。
智能机器人不一样：主动推送 `aibot_send_msg` 必须带 `chatid`，而 `chatid` 只有对方**先给机器人发过消息**才拿得到。
本服务订阅长连接、记住最近会话，再对外暴露一个和群机器人 webhook **同形状**的 `POST /webhook` —— 调用方只改 URL，不用改代码。

## 部署

```bash
# 1. 目录与凭据(Bot ID / Secret 不进仓库,放 600 的文件)
mkdir -p ~/.config/wecom-relay && chmod 700 ~/.config/wecom-relay
cat > ~/.config/wecom-relay/secrets.json <<'JSON'
{ "botId": "aib...", "secret": "..." }
JSON
chmod 600 ~/.config/wecom-relay/secrets.json

# 2. 起容器(host 网络:端点只监听 127.0.0.1:9099,容器外不可达)
docker compose up -d
docker logs --tail 20 wecom-relay
```

`compose.yaml` 里挂载 `~/.config/wecom-relay/secrets.json`（只读）与 `./data`（记住的会话）。

## 用

```bash
# 健康检查:chats 是已记住的会话数
curl -s http://127.0.0.1:9099/health

# 推送(与群机器人 webhook 同形状,可直接替换 URL)
curl -s -X POST http://127.0.0.1:9099/webhook \
  -H 'content-type: application/json' \
  -d '{"msgtype":"text","text":{"content":"测试通知"}}'
```

返回值也照群机器人的习惯：成功是 `{"errcode":0,"errmsg":"ok"}`；**还没人跟机器人说过话**时是 HTTP 503 + `{"errcode":503}`，这样调用方日志里能一眼看出原因。

## 第一次接线

机器人认不得任何人之前，`/health` 里 `chats` 是 0。让会收到通知的人**给这个机器人发一条消息**，
服务就会记住该会话（日志 `记住会话 xxx`），此后推送才有目标。群里用则把机器人拉进群并 @ 它一次。

## 安全

- 只监听 `127.0.0.1`（`BIND` 可改，但别改成 `0.0.0.0`）
- 可选共享令牌：设 `RELAY_TOKEN` 后，调用方要带 `x-relay-token`
- 凭据只在 600 的 `secrets.json` 里，仓库里没有明文

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SECRETS_FILE` | — | 含 `botId`/`secret` 的 JSON 路径（优先） |
| `BOT_ID` / `BOT_SECRET` | — | 没有 secrets 文件时直接给环境变量 |
| `BIND` | `127.0.0.1` | 监听地址 |
| `PORT` | `9099` | 监听端口 |
| `DATA_DIR` | `./data` | 记住的会话写这里（`chats.json`） |
| `RELAY_TOKEN` | 空 | 非空时校验 `x-relay-token` |
