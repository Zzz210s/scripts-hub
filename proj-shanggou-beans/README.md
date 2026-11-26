# 淘宝闪购吃货豆(自动领取)

淘宝闪购(原饿了么)的「赚吃货豆」任务是每天点十几次的活。这个程序替你点:
真浏览器打开任务页,按页面上的「领取」按钮,领完核对豆数,撞上人机验证就停手并通知。

## 为什么是「点页面」而不是「调接口」

2026-11-25 实测:纯 HTTP 调 `mtop.alibaba.svip.langrisser.act` 领取,不管从机房 IP
(腾讯云北京)还是家宽 IP,一律返回 `msgCode 100012 / 风控用户`,豆数不变;查询接口
(`langrisser.query`)与豆数接口(`restapi/.../foodie/homepage`)则完全正常。任务页自己会去
`ynuf.aliapp.org` 取 umid,那套设备指纹纯 HTTP 复现不了 —— 所以这里让页面自己去发请求,
我们只负责把按钮按下去。

接口清单、网关陷阱与重新取点的方法见 [PROTOCOL.md](PROTOCOL.md)。

## 它做了什么

```
守卫(暂停/安静时段/同伴在跑/今天已领) → 抢锁 → 起 Chromium(独立 profile)
  → 打开 h5.ele.me/svip/task-list → 读文本与豆数
  → 逐个点「领取」(每步 1.5~4.2 秒) → 再读豆数 → 记账 → 通知(仅在有变化或失败时)
```

- 幂等:当天真领到(`delta>0`)才记为完成;「今天没任务」不算完成,过几小时还能再跑。
- 撞验证:`请选择符合描述/滑动验证/安全验证/人机验证` 等字样出现即停手、截图、通知人工处理。
- 登录态:存在 `data/profile-<id>/` 里,由 `seed` 一次性灌入;之后每次运行页面自己刷新 cookie。
- 点多少次有上限(`SHANGGOU_MAX_CLICKS`,默认 8):宁可少点,别把次数堆成风控信号。

## 部署(云主机,套件第八个程序)

```bash
# 1. 目录(套件根 = /srv/apps/automation)
mkdir -p /srv/apps/automation/shanggou/{src,deploy,data,logs,secrets}
cp -r proj-shanggou-beans/src proj-shanggou-beans/package.json /srv/apps/automation/shanggou/
cp scripts/linux/shanggou/{Dockerfile,run.sh} /srv/apps/automation/shanggou/
cp scripts/linux/shanggou/deploy/run-once.sh /srv/apps/automation/shanggou/deploy/
chmod +x /srv/apps/automation/shanggou/{run.sh,deploy/run-once.sh}
cp proj-shanggou-beans/.env.example /srv/apps/automation/shanggou/.env

# 2. 账号与凭据
cat > /srv/apps/automation/shanggou/secrets/accounts.json <<'JSON'
[{ "id": "a1", "name": "主号", "cookieFile": "secrets/cookie-a1.txt" }]
JSON
chmod 600 /srv/apps/automation/shanggou/secrets/accounts.json
#    同一目录放 wecom-webhook.txt(可选,不配就不通知)

# 3. 构建(apt 装 chromium + 中文字体,约 1 分钟)
cd /srv/apps/automation/shanggou && docker build -f Dockerfile -t automation-shanggou:local .

# 4. 灌登录态(只需一次;cookie 失效后重跑)
cd /srv/apps/automation
docker compose -f compose.yaml run --rm -T shanggou-run seed
```

## 日常

| 动作 | 命令 |
| --- | --- |
| 跑一次(正式路径) | `bash /srv/apps/automation/shanggou/run.sh` |
| 只看页面有什么,不点 | `docker compose -f compose.yaml run --rm -T shanggou-run inspect` |
| 跳过守卫直接点一次 | `docker compose -f compose.yaml run --rm -T shanggou-run claim` |
| 重灌登录态 | `docker compose -f compose.yaml run --rm -T shanggou-run seed` |
| 今天领了多少 | `cat /srv/apps/automation/shanggou/data/state.json` |
| 逐事件日志 | `tail -f /srv/apps/automation/shanggou/data/runner.log` |
| 暂停某天 | `touch /srv/apps/automation/shanggou/data/paused` |

## cookie 从哪来(登录态失效时)

登录态由**导出的 cookie** 灌进 profile,不改动任何人日常浏览器的 profile。
在 Windows 上用仓库里的工具导:

```powershell
set CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe
set COOKIE_OUT=%TEMP%\shanggou-cookie.txt
node proj-shanggou-beans\scripts\windows\export-cookies.mjs   # 弹窗,扫码/短信登录一次
```

把 `shanggou-cookie.txt` 传到服务器 `secrets/cookie-a1.txt`(600),再跑上面的 `seed`。
`seed` 会验证页面能读到豆数,读不到就是 cookie 不对,重导。

## 配置项

见 [.env.example](.env.example)。三个值得注意的:

- `SHANGGOU_LNG/LAT`:填**账号常用收货城市**的坐标。页面拿不到定位时会显示「无法获取位置信息」。
- `SHANGGOU_MAX_CLICKS`:一次最多点几下。8 是实测够用的值。
- `SHANGGOU_HEADLESS`:默认 1;若某天开始出现验证,改成 0 并在宿主机配 Xvfb 试有头模式。

## 已知边界

- 只做签到与点击类任务;**不做**浏览/视频类长驻任务、不做豆子兑换、不碰下单。
- 不破解滑块与九宫格:撞上就把控制权交给真人,这是设计而不是缺陷。
- 两个账号就配两条 `accounts.json`,各一份 cookie 与独立 profile(共用 profile 会互相顶掉登录态)。
