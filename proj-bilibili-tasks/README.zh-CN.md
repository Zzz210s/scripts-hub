# B站任务

[English](README.md) | 简体中文

无人值守跑 B站每日经验任务:自研的 Node 薄壳调用上游
[BiliBiliToolPro](https://github.com/RayWangQvQ/BiliBiliToolPro) 的 Console 程序,
带企业微信通知,守卫链与本仓库其它程序同一套。

## 做什么

- 跑每日经验任务:登录、观看、分享,以及每天最多 5 枚的投币。
- 由薄壳负责年度大会员的 B币券:先查状态,该领才领,领后自证,结果并入 result 消息。
- 顺手做纯获取型任务:大会员大积分、漫画签到、漫读券。
- 不做任何消耗性或破坏性动作:花硬币、花银瓜子、批量取关、发直播弹幕、改关注分组这些任务
  都显式关闭。
- 一次运行最多两条通知:`start` 在跑之前,`result` 在跑完之后;`skip` 只写运行日志。

## 架构

```
config/schedule.json        什么时候跑(默认关闭,扫码登录后再打开)
scripts/linux/bilibili/     宿主侧运行器、Dockerfile、容器入口
proj-bilibili-tasks/
  src/cli.js                run / login / status / cookies / check / pause / resume
  src/run.js                一次运行:守卫 -> 券 -> Console -> 归类 -> 通知 -> 落状态
  src/*.js                  纯模块(member、voucher、donate、classify、messages、guards 等)
  src/notify.js             共享的 wecom-core 发送块(第 4 份,由漂移检测锁住)
  test/*.test.js            离线测试;网络与子进程全部用桩
  scripts/windows/          Windows 备用入口
```

- 薄壳负责:守卫、券流程、投币策略、退出码/stdout 特征归类、通知、本地状态。
- 上游 Console 负责:启用任务的 B站接口调用。它以子进程方式运行,任务清单固定,
  每个任务都有显式的开/关矩阵。
- 上游源码不入库。镜像构建时按 `VENDOR_COMMIT.txt` 与
  `scripts/linux/bilibili/Dockerfile` 里记录的同一个 commit 取用。

## 前置条件

- Node.js >= 20.11(薄壳零 npm 依赖,用内置 test runner)。
- 容器内需要 .NET 10 runtime(上游 Console)。
- 构建镜像需要网络(取上游源码与基础镜像)。

## 部署

服务器上,套件根目录按 `/srv/apps/automation`:

```
mkdir -p /srv/apps/automation/bilibili/{data,logs,secrets,deploy}
cp -r proj-bilibili-tasks/src                /srv/apps/automation/bilibili/src
cp scripts/linux/bilibili/deploy/run-once.sh /srv/apps/automation/bilibili/deploy/
cp scripts/linux/bilibili/Dockerfile         /srv/apps/automation/bilibili/Dockerfile

cd /srv/apps/automation/bilibili
docker build -f Dockerfile -t automation-bilibili:local .
```

再放凭据并做一次扫码登录:

```
printf '%s' '<你的企业微信 webhook 地址>' > /srv/apps/automation/bilibili/secrets/wecom-webhook.txt
chmod 600 /srv/apps/automation/bilibili/secrets/wecom-webhook.txt

docker compose -f /srv/apps/automation/compose.yaml run --rm -T bilibili-run \
  -e Ray_RunTasks=Login bash -c 'cd /app && dotnet Ray.BiliBiliTool.Console.dll'
```

控制台会打印二维码块字符与一个 `https://tool.lu/qrcode/basic.html?text=...` 链接,
用手机 B站 App 扫那个链接里的二维码。上游只轮询约 50 秒,看到就立刻扫,超时了就重跑一次。
登录产物写到 `secrets/cookies.json`;之后 `node src/cli.js check` 会打印会员类型、硬币余额与券状态。

`cookies.json` 就位后,容器会跟着套件队列跑。`run-all.sh` 每次触发都会调它:还没登录时第一次
以 `no-credentials` 静默退出;成功跑过之后第二次触发由 `done-today` 守卫跳过。

Windows 只是备用入口:把 `config/schedule.json` 里 `bilibili-tasks` 的 `enabled` 改成 `true`,
再跑 `node scripts/apply-schedule.mjs --apply --yes`。

## 配置

所有键都是环境变量,由 `src/config.js` 读取。除了凭据文件,一次运行不需要别的配置。常用键:

| 环境变量 | 默认值 | 含义 |
| --- | --- | --- |
| `BILIBILI_COOKIES_FILE` | `<root>/secrets/cookies.json` | 登录产物 |
| `BILIBILI_WEBHOOK_FILE` | `<root>/secrets/wecom-webhook.txt` | 企业微信通道 |
| `BILIBILI_COIN_KEEP` | `20` | 保留的硬币数;余额不高于它就不投币 |
| `BILIBILI_COIN_MAX` | `5` | 每天最多投几枚 |
| `BILIBILI_MAX_ATTEMPTS` | `2` | 一天最多真跑几次 |
| `BILIBILI_CONSOLE_TIMEOUT_MINUTES` | `20` | 薄壳侧 Console 超时 |
| `BILIBILI_FREE_MEM_MB` | `800` | 内存闸门 |
| `BILIBILI_BUSY_PEERS` | 空 | 逗号分隔的同伴锁文件 |

上游任务矩阵在 `src/console-runner.js` 里:只打开 `Daily`、`VipBigPoint`、`Manga`、
`MangaPrivilege`,其余每个任务都显式写 `Ray_*TaskConfig__IsEnable=false` 关掉。

## 验证

```
cd proj-bilibili-tasks
npm test                       # 离线,不联网、不起子进程
node src/cli.js run --dry-run  # 只打印会发什么
node src/cli.js status         # 本地状态
node src/cli.js cookies        # 只打印账号,绝不打印 cookie 值
```

在仓库根还有:`bash scripts/setup-bilibili-tasks.sh` 跑离线自检;
`node scripts/check-wecom-drift.mjs` 校验通知核心与另外三份逐字节一致。

## 回滚

从 `scripts/linux/compose.yaml` 删掉 `bilibili-run` 服务,删掉 `scripts/linux/run-all.sh` 里调用
`bilibili/run.sh` 的那一段,并把 `config/schedule.json` 的 `enabled` 改回 `false`。
`data/` 与 `secrets/` 留在宿主机,重新启用时不用再登录一次。

## 许可

GPL-3.0-only。镜像按 `VENDOR_COMMIT.txt` 记录的固定 commit 从上游构建;上游来源、许可与我们的
改动声明见 `NOTICE`。镜像自用,不对外分发。
