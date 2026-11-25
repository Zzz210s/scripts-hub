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

## 推送内容改造(Dockerfile + patch_notifier.py)

上游的账号摘要是固定三段(游戏社区 / 云游戏 / 米游币),没跑的那段也印一行「本次未执行…」。
本套件只开游戏社区签到,所以加了一处本地补丁,镜像 `miyoushe-signin:local` 由本目录的
`Dockerfile`(`patch_local.py`)从上游镜像构建:

- 账号摘要只输出本次真跑过的段;整段都没跑就不出现。
- 结果段不印「进度 [####----] 100% 完成」那一行 —— 汇总行已经说了成功几个,进度条是重复信息
  (2026-11-25 用户要求)。改的是文本渲染函数,HTML 通道的彩色进度条没动。
- 推送不再带「详细日志」整段(2026-11-25 用户要求)—— 那是签到过程的逐行复述,群里没人看。
  这一段是模板文件(`templates/push/*.md|txt|html`)里的静态内容,所以补丁顺手改四个模板。
- 米游币的「跑过没有」判定改严。上游是 `any("米游币" in line or "社区签到" in line)`,
  「游戏社区签到汇总」里含「社区签到」,于是永远判成跑过,印出一段全 0 的空摘要 ——
  这正是第一条堵不住它的原因。改成只认真跑的痕迹(汇总行或任务计数)。

补丁是整函数替换,替换前先断言锚点存在:上游一改结构,构建直接失败,不会出现
「补丁静默失效、镜像照常起」。验证方式(不往群里发东西):

```bash
# 把最近一次运行日志洗成消息文本,交给容器渲染 markdown,肉眼确认段落
sudo docker compose run --rm -T miyoushe-run python -c "
import pathlib; from miyouqian.service import notifier
print(notifier.build_push_markdown('米游签任务完成', pathlib.Path('/app/state/.test_msg.txt').read_text(), True))"
```

上游更新后要重建本镜像(上游镜像要先 `docker pull ghcr.chenby.cn/...` 再 tag 回 ghcr.io 名):

```bash
cd /srv/apps/automation && sudo docker compose build --pull=false miyoushe-run
```

## 云游戏签到(需另配 token)

云游戏接口要的是 `x-rpc-combo_token`,不是米游社 cookie,而且云原神与云绝区零的 token 不通用。
配置分三处:

```yaml
features:
  cloud_game_checkin: true
cloud_games:
  enabled: [genshin, zzz]
accounts:
  - name: main
    cloud_games:
      tokens:
        genshin: "<云原神的 x-rpc-combo_token>"
        zzz: ""
```

获取(云原神):

1. 浏览器打开 <https://ys.mihoyo.com/cloud/#/> 并登录同一账号。
2. F12 → Network,过滤 `wallet/wallet/get`,刷新或进「钱包 / 时长」页。
3. 点开成功的那条请求,请求头里复制 `X-Rpc-Combo_token` 的整段值。

云绝区零没有网页版,只能抓包(App 或客户端),参考上游 README 里那条 bili33 的教程。
未配置某个游戏的 token 时,那个游戏会被静默排除;两个都没配才会印一行「未配置 token，已跳过」。
星穹铁道云游戏不可选(版本更新直接送 600 分钟,不需要每日签到)。
