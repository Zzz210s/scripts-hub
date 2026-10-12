# 百度贴吧签到

[English](README.md) | 简体中文

多账号的百度贴吧每日签到:把每个账号已关注的吧全部签一遍,再把关注列表读回来核对每个吧
今天真的显示已签。零 npm 依赖,唯一的网络流量就是签到协议本身。

## 做什么

- 逐个账号读取已关注的吧列表,把列表里的每个吧都签一次。
- 签完读回核对:只有接口对该吧报出 `is_sign` 才算完成。这一层读回通过时,才把当天记为
  「已完成」。
- 可以用 `TIEBA_FORUMS` 把本次范围收窄到一个白名单。
- 一次真跑最多两条通知:`start` 在跑之前,`result` 在跑完之后;静默跳过只写运行日志。
- 账号串行处理。每个账号带唯一 id,两个同名显示名的账号不会串号。

## 范围与风险

程序对贴吧只发两类请求:

- **读**:取 `tbs`,取已关注的吧列表。
- **一次写**:签到调用 `POST c.tieba.baidu.com/c/c/forum/sign`。

它不发帖、不回帖、不关注也不取关、不点赞、不发私信、不花任何东西。这些动作在本目录里根本
没有实现,不存在能走到它们的代码路径。签到本身是唯一的写请求,对同一个吧一天一次,重复调用
无副作用。

这类签到脚本社区里没有封号证据。这不是保证,也不是放宽边界的理由:本项目就守住读与签到
这条线。想要更宽的贴吧机器人,请另立一个程序,让这里的边界保持可审计。

## 架构

```
config/schedule.json        什么时候跑 · 默认关闭,真机验证后再打开
scripts/linux/tieba/        宿主侧运行器、Dockerfile、容器入口
proj-baidu-tieba/
  src/cli.js                run / check / report / help
  src/run.js                一次运行:守卫 -> 锁 -> 逐账号签到 -> 读回对账 -> 落状态 -> 通知
  src/*.js                  纯模块:client、sign、verify、guards、lock、state、messages、notify
  src/notify.js             共享的 wecom-core 发送块 · 与其余实现逐字节一致的一份
  test/*.test.js            离线测试 · 网络、时钟、发送全部用注入的桩
  scripts/windows/          锁状态与内存查询入口 · 与平台无关 · 同伴互查用
```

- 运行器负责:守卫、单实例锁、逐账号签到、读回对账、本地状态、通知。
- 网络、时钟、内存、同伴、发送全部从 `deps` 注入,所以整次运行都能离线跑通。

## 前置条件

- Node.js >= 20.11。运行器零 npm 依赖,用内置 test runner。
- 容器部署需要 Docker,以及 `/srv/apps/automation` 上的套件 compose 文件。

## 凭据

全部放在程序旁边的 `.env` 里,键由 `src/config.js` 读取。

| 键 | 必需 | 含义 |
| --- | --- | --- |
| `ACCOUNT_n_BDUSS` | 是 | 第 n 个账号的 `BDUSS` cookie 值 |
| `ACCOUNT_n_STOKEN` | 否 | `STOKEN` cookie 值 · 有就拼进 cookie 串 |
| `ACCOUNT_n_NAME` | 否 | 只用于消息里的显示名 · 缺省是 `账号 n` |

在浏览器里登录 `tieba.baidu.com` 后,从该站点 cookie 里复制 `BDUSS` 那一项的值。把它当密码
对待,它是完整的登录凭据,会过期。当所有账号都过期时,程序会推一条 `需要你处理` 请你更新。

webhook 地址写进 `secrets/wecom-webhook.txt`,一行,权限 600。没有它程序照跑,只是不推送。

## 配置

所有键都是环境变量,同名时覆盖 `.env` 里的值。常用键:

| 环境变量 | 默认值 | 含义 |
| --- | --- | --- |
| `TIEBA_FORUMS` | 空 | 逗号分隔的目标吧白名单;空 = 签全部已关注吧 |
| `TIEBA_INTERVAL_MS` | `2000` | 账号之间的间隔,压低请求频率 |
| `TIEBA_MAX_ATTEMPTS` | `3` | 每个逻辑日最多真跑几次 |
| `TIEBA_QUIET_START` / `TIEBA_QUIET_END` | `20:00` / `23:00` | 安静时段 · 跳过且不推送 |
| `TIEBA_MIN_FREE_MB` | `800` | 内存闸门 |
| `TIEBA_DAY_BOUNDARY_HOUR` | `4` | 逻辑日 04:00 换日 · 凌晨那次算前一天 |
| `TIEBA_WEBHOOK_FILE` | `secrets/wecom-webhook.txt` | 企业微信通道 |
| `TIEBA_STATE_DIR` / `TIEBA_LOCK_DIR` | `data` / `logs` | 状态与锁的位置 |
| `BUSY_PEERS` | 空 | 逗号分隔的同伴锁文件,用于错峰判定 |
| `TIEBA_DRY_RUN` | 空 | 置 `1` 强制预览,连 `report` 也预览 |

## 部署到服务器

套件根目录按 `/srv/apps/automation`:

```
mkdir -p /srv/apps/automation/tieba/{data,logs,secrets,deploy}
cp proj-baidu-tieba/package.json      /srv/apps/automation/tieba/package.json
cp -r proj-baidu-tieba/src            /srv/apps/automation/tieba/src
cp -r proj-baidu-tieba/scripts        /srv/apps/automation/tieba/scripts
cp scripts/linux/tieba/deploy/run-once.sh /srv/apps/automation/tieba/deploy/
cp scripts/linux/tieba/Dockerfile     /srv/apps/automation/tieba/Dockerfile

cd /srv/apps/automation/tieba
docker build -f Dockerfile -t automation-tieba:local .
```

再放凭据:

```
cat > /srv/apps/automation/tieba/.env <<'EOF'
ACCOUNT_1_BDUSS=<第 1 个账号的 BDUSS>
ACCOUNT_1_NAME=<第 1 个账号的显示名>
EOF
chmod 600 /srv/apps/automation/tieba/.env

printf '%s' '<你的企业微信 webhook 地址>' > /srv/apps/automation/tieba/secrets/wecom-webhook.txt
chmod 600 /srv/apps/automation/tieba/secrets/wecom-webhook.txt
```

compose 服务名是 `tieba-run`。容器入口会把参数透传给 `src/cli.js`,所以子命令直接写在服务名
后面:

```
docker compose -f /srv/apps/automation/compose.yaml run --rm -T tieba-run check
docker compose -f /srv/apps/automation/compose.yaml run --rm -T tieba-run report
```

只有当调度闸门判定该程序启用时,`run-all.sh` 才会调 `tieba/run.sh`。程序默认关闭:先用
`check` 与一次 `run` 验证,再把 `config/schedule.json` 里 `baidu-tieba` 的 `enabled` 改成
`true`。Linux 侧读的是 `linuxEnabled`,缺省回落到 `enabled`。

## 验证

```
cd proj-baidu-tieba
npm test                       # 离线,不联网、不起子进程
node src/cli.js check          # 只读:tbs、关注吧数量、已签数量与对账结论
node src/cli.js run --dry      # 只打印会推送什么,不发送、不落盘
node src/cli.js report --dry   # 把当天最后一条结果重渲染出来
```

有账号取不到 `tbs` 或关注列表时 `check` 退出码为 1,部署侧可以据此做巡检。
`run --dry` 与 `TIEBA_DRY_RUN=1` 都不联网、不写状态;仍会读 `.env` 与 `data/state.json`。

在仓库根,`node scripts/check-wecom-drift.mjs` 校验通知核心与另外四份逐字节一致。

## 日志与状态

| 路径 | 内容 |
| --- | --- |
| `logs/last-run.log` | 宿主侧最近一次运行输出 · 上一次在 `logs/previous-run.log` |
| `logs/runner.log` | 宿主运行器记账 · 退出码与看门狗记录 |
| `logs/run.lock` | 单实例锁 · 套件约定里同伴会来找的路径 |
| `data/state.json` | 每天的完成状态、尝试次数、暂停标记 |
| `data/history.jsonl` | 每次运行一行 JSON · `report` 的数据源 |

## 消息

标题按四段式 `<程序名> · <账号或账号数> · <日期> · <动作>`,程序名是 `百度贴吧签到`。
`start` 在真跑前发出,`result` 在跑完后发出。`done-today`、`peer-running`、`quiet-hours`
三种跳过是静默的;其余跳过原因会推一条 `action`,因为放着不管就等于永远不跑。
发送层规则见 [../docs/wecom-rules.md](../docs/wecom-rules.md)。

## 回滚

从 `scripts/linux/compose.yaml` 删掉 `tieba-run` 服务,删掉 `scripts/linux/run-all.sh` 里调用
`tieba/run.sh` 的那一段,并把 `config/schedule.json` 里 `baidu-tieba` 的 `enabled` 改回
`false`。`data/`、`logs/` 与 `secrets/` 留在宿主机,重新启用不用再配置一遍。

## 许可

GPL-3.0-only,与仓库其它程序一致。实现全部自己写,没有复制任何第三方代码;所依据的协议事实
与出处列在 `NOTICE`。
