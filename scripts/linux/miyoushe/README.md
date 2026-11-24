# 米游社签到(第七个程序)

底座是上游 [Marchen-orz/MiyoQian](https://github.com/Marchen-orz/MiyoQian)(MIT)的预构建镜像,
本目录只有部署件:一个 `run.sh` 和一份配置模板。**没有本地源码,升级 = 换镜像**。

## 为什么用它

2026-11-20 米游社改了登录与签到接口:游戏签到路径从 `/event/luna/...` 变成
`/event/luna/<game_biz>/...`,且必须带 `x-rpc-signgame` 与 V2 身份(`cookie_token_v2` /
`ltoken_v2` / `account_id_v2`),网页登录签发的 v1 cookie 全系 -100。MiyoQian 在 11-21 就按抓包
改完了新路径,是当时少数还在动的实现;MihoyoBBSTools 只修了 V2 cookie,国服签到仍是旧路径。

## 形态

一次性容器(`compose.yaml` 的 `miyoushe-run`):覆盖镜像默认的 `serve` 常驻模式,只跑

```
python main.py --config /app/state/config.yaml run --games-only
```

跑完即退。顺序、flock 单实例、看门狗、崩溃兜底都在套件根目录的 `run-lib.sh`,本目录的
`run.sh` 只声明四个变量。调度由 `runner.sh` 的 PROGRAMS 表管(每天 08:00 一档,错过会补跑)。

## 一次扫码登录

```bash
cd /srv/apps/automation
docker compose run --rm -T miyoushe-run \
  python main.py --config /app/state/config.yaml login --account main --timeout 50
```

二维码 PNG 落在 `miyoushe/data/qrcode.png`,同一条命令会把 `ltoken` / `cookie_token`(v2)
写进 `data/config.yaml` 的 `accounts` 与 `data/data/credentials.yaml`。

**二维码有效期很短(实测一分钟上下)**:要么把 PNG 连续同步到本机边扫,要么临时起 Web 面板
(`docker run -p 127.0.0.1:5890:5890 … serve --host 0.0.0.0`)走 SSH 隧道扫,面板上的码点一次生成一次。

## 镜像

`ghcr.io` 在国内实测约 2 KB/s,拉不动。用镜像拉再打回官方名:

```bash
docker pull ghcr.chenby.cn/marchen-orz/miyouqian:latest
docker tag  ghcr.chenby.cn/marchen-orz/miyouqian:latest ghcr.io/marchen-orz/miyouqian:latest
```

`ghcr.nju.edu.cn` 也试过:拉到一半稳定报 `httpReadSeeker ... failed to do request`,不可靠。

## 验证与排错

```bash
./miyoushe/run.sh                        # 立刻跑一次(日志 miyoushe/logs/last-run.log)
./runner.sh --plan                       # 看这一跳会不会轮到它
./runner.sh miyoushe                     # 强制只跑它(走 runner 的计数与看门狗)
```

日志里出现 `游戏社区签到汇总:成功 N,失败 0` 即正常;`今日已签到` 也按成功算。
`-100 请登录后重试` 说明凭证不是 V2(重新扫码);`-3501` 是二维码过期。

## 数据在哪

| 路径 | 内容 |
| --- | --- |
| `data/config.yaml` | 配置 + 账号的 v2 token + 设备指纹 |
| `data/data/credentials.yaml` | 同一套凭证的独立副本 |
| `data/logs/` | 程序自己的日志 |
| `logs/last-run.log` | 最近一次运行的完整输出(宿主侧) |
| `secrets/wecom-webhook.txt` | 群机器人 webhook(600) |
