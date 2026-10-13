# 网易云音乐每日签到

[English](README.md) | 简体中文

一个最小的自托管网易云音乐签到程序:完成 VIP 乐签、读回云贝余额,支持一组账号,推送企业微信。
零 npm 依赖;它发出的请求只有**读**与**签到**两类。

部署前请先读[范围与风险](#范围与风险) —— 这是本套件里唯一一个**厂商条款明文禁止第三方客户端**的程序。

## 它做什么

- 跑 VIP 乐签流程:`task/sign` 加必须再发的 `checkin/history/detail`,然后**读回**签到状态;只有业务结果确认「已签」才算当天完成。
- 读云贝余额并渲染进消息。**不领**云贝。
- 真跑前推一条 `start`,跑完推一条 `result`。静默跳过关掉只写日志。
- 遇到鉴权或限流:**当天熔断、不重试、只发一次请求**,并推一条 `action` 让你去换 cookie。

## 范围与风险

**厂商条款**。网易云音乐的用户协议禁止第三方客户端与逆向。跑它是个人决定,而代价有实证:
同类社区项目已有自行归档并写「建议不要继续使用」的,其 issue 里出现过**账号封禁**与**音乐人身份被取消**。

**这个程序刻意不做、本目录里没有实现、也不存在任何能到达的代码路径**:

- 不听歌打卡、不上报播放量
- 不评论、不分享、不关注、不发私信、不发动态、不碰 MV
- 不做音乐人 / 云豆 / 奖励类任务,不领云贝,不领礼品
- 不做任何登录:没有账号密码、短信、扫码流程,只用 cookie

**它确实做的**:读签到状态与云贝余额,调用两个 VIP 乐签接口。串行、每请求间隔 ≥3 秒、每账号每天一次。

**跑在哪里**。cookie 在浏览器里取得,然后留在跑它的那台机器上。**换出口 IP 本身就是风险信号**,
所以位置一次定死:程序不做迁移,也不用代理。

## 架构

```
config/schedule.json          什么时候跑 · 默认关闭,真机验证通过才打开
scripts/linux/netease/        宿主侧运行器、Dockerfile、容器入口
proj-netease-cloud/
  src/cli.js                  run / check / probe / report / help
  src/run.js                  一次运行:守卫 → 取锁 → 账号体检 → 签到 → 读回 → 落盘 → 通知
  src/crypto.js               weapi / eapi 参数加密 · 所有常量集中在这一处
  src/verify.js               错误分类矩阵与基线辅助
  src/*.js                    client、config、fields、pacing、vip、yunbei、guards、lock、state、messages
  src/notify.js               共享 wecom-core 发送块 · 逐字节一致的副本之一
  test/*.test.js              离线测试 · 网络、时钟、发送全部注入桩
  scripts/windows/            锁状态与可用内存查询入口 · 与平台无关 · 同伴互查用
```

## 环境要求

- Node.js ≥ 20.11。零 npm 依赖,测试用内置 runner。
- 容器部署:Docker,以及套件的 `/srv/apps/automation/compose.yaml`。

## 凭据

单一真源是程序目录下的 `.env`,由 `src/config.js` 读。

| 键 | 必填 | 含义 |
| --- | --- | --- |
| `ACCOUNT_n_MUSIC_U` | 是 | 第 n 个账号的 `MUSIC_U` cookie 值 |
| `ACCOUNT_n_NAME` | 否 | 只用于消息里的显示名 · 默认 `账号 n` |

在 `music.163.com` 登录后从浏览器复制 `MUSIC_U` cookie 值。它是完整登录凭据,按密码对待。
失效时程序报鉴权失败并提醒你换新,**永远不会自己尝试登录**。

企业微信 webhook 写到 `secrets/wecom-webhook.txt`,一行,权限 600。没有它程序照跑,只是不推送。

## 配置

每个键都有同名环境变量;显式变量覆盖 `.env` 里的同名键。

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `NETEASE_REQUEST_INTERVAL_MS` | `3000` | 请求间隔 · 流程自身下限是 3 秒 |
| `NETEASE_MAX_ATTEMPTS` | `3` | 每个逻辑日真跑次数上限 |
| `NETEASE_QUIET_START` / `NETEASE_QUIET_END` | `20:00` / `23:00` | 安静时段 · 跳过且不推送 |
| `NETEASE_MIN_FREE_MB` | `800` | 内存守卫 |
| `NETEASE_DAY_BOUNDARY_HOUR` | `4` | 逻辑日从 04:00 起算,凌晨那次算前一天 |
| `NETEASE_TIMEOUT_MS` | `10000` | 单请求超时 |
| `NETEASE_WEBHOOK_FILE` | `secrets/wecom-webhook.txt` | 企业微信通道 |
| `NETEASE_STATE_DIR` / `NETEASE_LOCK_DIR` | `data` / `logs` | 状态与锁位置 |
| `BUSY_PEERS` | 空 | 逗号分隔的同伴锁文件,用于错峰判定 |
| `NETEASE_DRY_RUN` | 空 | `1` 时连 `report` 也走预览 |

## 服务器部署

套件根目录为 `/srv/apps/automation`:

```
mkdir -p /srv/apps/automation/netease/{data,logs,secrets,deploy}
cp proj-netease-cloud/package.json          /srv/apps/automation/netease/package.json
cp -r proj-netease-cloud/src                /srv/apps/automation/netease/src
cp -r proj-netease-cloud/scripts            /srv/apps/automation/netease/scripts
cp scripts/linux/netease/deploy/run-once.sh /srv/apps/automation/netease/deploy/
cp scripts/linux/netease/Dockerfile         /srv/apps/automation/netease/Dockerfile

cd /srv/apps/automation/netease
docker build -f Dockerfile -t automation-netease:local .
```

然后放凭据:

```
cat > /srv/apps/automation/netease/.env <<'EOF'
ACCOUNT_1_MUSIC_U=<MUSIC_U cookie 值>
ACCOUNT_1_NAME=<账号名>
EOF
chmod 600 /srv/apps/automation/netease/.env

printf '%s' '<你的企业微信 webhook>' > /srv/apps/automation/netease/secrets/wecom-webhook.txt
chmod 600 /srv/apps/automation/netease/secrets/wecom-webhook.txt
```

compose 服务名是 `netease-run`,入口把参数透传给 `src/cli.js`:

```
docker compose -f /srv/apps/automation/compose.yaml run --rm -T netease-run check
docker compose -f /srv/apps/automation/compose.yaml run --rm -T netease-run probe
```

`run-all.sh` 只在调度闸门判定「启用」时才调 `netease/run.sh`。默认关闭:先用 `check` 与一次 `run` 验证,
再把 `config/schedule.json` 里 `netease-cloud` 的 `enabled` 置真。

## 验证

```
cd proj-netease-cloud
npm test                        # 离线,不联网、不起子进程
node src/cli.js probe           # 只读:签到状态与云贝余额 · 绝不签到
node src/cli.js check           # 只读体检,可给部署探针用
node src/cli.js run --dry       # 打印将要推送的消息,不发送、不写盘
node src/cli.js report --dry    # 重新渲染当天的上一次结果
```

`probe` 是给第一次真机验证用的:它回答「哪些接口只靠 cookie 就能请求、结果落在哪个字段」,而不改变任何状态。
`run --dry` 与 `NETEASE_DRY_RUN=1` 不联网、不写状态,但仍会读 `.env` 与 `data/state.json`。

在仓库根目录跑 `node scripts/check-wecom-drift.mjs` 可校验通知核心与另外五份副本逐字节一致。

## 日志与状态

| 路径 | 内容 |
| --- | --- |
| `logs/last-run.log` | 宿主侧上一次运行的输出 · 上一次在 `logs/previous-run.log` |
| `logs/runner.log` | 宿主运行器记账 · 退出码与看门狗记录 |
| `logs/run.lock` | 单实例锁 · 套件约定路径,同伴按它找 |
| `data/state.json` | 逐日完成状态、尝试次数、熔断标记、基线 |
| `data/history.jsonl` | 每次运行一行 JSON · `report` 的数据源 |

## 消息

标题沿用四段式 `<程序> · <账号或账号数> · <日期> · <动作>`,程序名是 `网易云音乐签到`。
`done-today`、`peer-running`、`quiet-hours` 三类跳过静默;其余跳过原因会推 `action`,
因为放着不管就意味着程序从来不跑。发送层规则见 [../docs/wecom-rules.md](../docs/wecom-rules.md)。

## 回退

从 `scripts/linux/compose.yaml` 删掉 `netease-run` 服务、从 `scripts/linux/run-all.sh` 删掉 `netease/run.sh` 那一步,
再把 `config/schedule.json` 里 `netease-cloud` 的 `enabled` 置假。`data/`、`logs/`、`secrets/` 都留在宿主上。

## 许可

GPL-3.0-only,与仓库其余部分一致。实现为自研,未复制任何第三方代码;
它依赖的协议事实与仍需真机核对的项都列在 `NOTICE` 里。
