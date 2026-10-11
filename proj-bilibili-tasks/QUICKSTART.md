# QUICKSTART:从零到跑起来

三条命令、一次扫码、一个 webhook。离线测试不需要任何凭据。

## 0. 前置条件

- Node.js >= 20.11(薄壳零依赖,不需要 `npm install`)。
- 服务器上能 `docker build` 与 `docker compose`;构建镜像需要能访问
  `mcr.microsoft.com`、`codeload.github.com` 与 Debian 源。
- 一个独立的企业微信群机器人 webhook(不同群、不同 key)。没有它程序照跑,只是不推送。

## 1. 自检(在本机或服务器上,离线)

```
cd proj-bilibili-tasks
npm test                          # 105 条离线测试
node src/cli.js run --dry-run     # 只打印会发什么,不联网、不起子进程、不写状态
```

仓库根还有 `bash scripts/setup-bilibili-tasks.sh`(自检 Node 版本、项目文件、离线测试、干跑、凭据)。

## 2. 构建镜像(服务器)

在服务器应用目录里组装 `src/`、`deploy/`、`Dockerfile`,然后构建:

```
mkdir -p /srv/apps/automation/bilibili/{data,logs,secrets,deploy}
cp -r proj-bilibili-tasks/src                /srv/apps/automation/bilibili/src
cp scripts/linux/bilibili/deploy/run-once.sh /srv/apps/automation/bilibili/deploy/
cp scripts/linux/bilibili/Dockerfile         /srv/apps/automation/bilibili/Dockerfile

cd /srv/apps/automation/bilibili
docker build -f Dockerfile -t automation-bilibili:local .
```

镜像从上游固定 commit 取源码 publish Console,再把 Node 可执行文件拷进 runtime 阶段。
构建前先探一次 `docker pull mcr.microsoft.com/dotnet/runtime:10.0` 与
`curl -I https://codeload.github.com`;不通就先解决网络,不要伪造构建成功。

## 3. 放凭据

```
printf '%s' '<你的企业微信 webhook 地址>' > /srv/apps/automation/bilibili/secrets/wecom-webhook.txt
chmod 600 /srv/apps/automation/bilibili/secrets/wecom-webhook.txt
```

仓库里不放 webhook 的 key;文档只记路径。`secrets/cookies.json` 由下一步的扫码登录生成。

## 4. 扫码登录(唯一必须人做的步骤)

```
docker compose -f /srv/apps/automation/compose.yaml run --rm -T bilibili-run login
```

- 子命令由容器入口 `deploy/run-once.sh` 透传给 `src/cli.js`,所以 `login` / `check` / `status` 都是
  在服务名后面直接写命令;不带子命令就是跑一次任务。
- 控制台先打印二维码的半角块字符,随后打印一个
  `https://tool.lu/qrcode/basic.html?text=...` 链接。块字符在服务器终端里往往看不清,
  **用手机 B站 App 扫那个链接里的二维码**。
- **上游轮询 10 次,每次之间约 20 秒,所以窗口约 3 分钟**(2026-10-11 在服务器实测;
  原先文档写的"10 次 × 5 秒 = 50 秒"是错的 —— 登录轮询也吃 `IntervalSecondsBetweenRequestApi`
  的 20 秒间隔)。超时会报「登录超时」,重跑上面的命令即可。
- 成功后确认 `/srv/apps/automation/bilibili/secrets/cookies.json` 存在且里面有 `DedeUserID`。

## 5. 验证

```
node src/cli.js check      # 会员类型 / 硬币余额 / 券状态(只调只读接口)
node src/cli.js cookies    # 只打印账号末尾四位与条数,绝不打印 cookie 值
node src/cli.js status     # 上次运行、当天次数、硬币台账与券历史
```

容器内跑同样三条:

```
docker compose -f /srv/apps/automation/compose.yaml run --rm -T bilibili-run check
docker compose -f /srv/apps/automation/compose.yaml run --rm -T bilibili-run cookies
docker compose -f /srv/apps/automation/compose.yaml run --rm -T bilibili-run status
```

## 6. 启用

- Linux:不用改配置。`run-all.sh` 每次都调 `bilibili/run.sh`,程序自己用守卫与 `no-credentials` 早退。
- Windows(备用):把 `config/schedule.json` 里 `bilibili-tasks.enabled` 改成 `true`,再
  `node scripts/apply-schedule.mjs --apply --yes`。`%BILIBILI_DIR%` 要在
  `~/.config/automation-suite/local-paths.env` 里有值(项目就在本仓库里时留空注释即可)。

## 常见失败

| 现象 | 原因与处理 |
| --- | --- |
| 企业微信收到「需要你处理 · Cookie 已失效」 | 登录态过期或未登录。重跑第 4 步。 |
| 日志里 `[跳过] no-credentials` | 还没登录(`secrets/cookies.json` 不存在)。重跑第 4 步。 |
| 日志里 `[跳过] done-today` | 今天已经成功跑过一次,第二次触发按设计静默跳过。 |
| 日志里 `[跳过] peer-running` | 另一次运行还在跑;或同伴锁文件还新。等下一次触发。 |
| `docker build` 在 `dotnet publish` 失败 | 多半是取上游源码失败(网络)或 commit 写错。核对 `VENDOR_COMMIT.txt` 与 Dockerfile 的 `ARG UPSTREAM_SHA`。 |
| 通知一直没到 | 检查 `secrets/wecom-webhook.txt` 是否存在、权限是否 600;`node src/cli.js check` 不推送。 |
| 券那行写 `会员券:状态未知 · 跳过 B币券` | 接口返回了没见过的 state,程序保守地不重复领取。 |
| 投币那行写 `投币:跳过 · 无法确认关注列表` | 关注数接口失败,程序宁可少拿经验也不给陌生人投币。 |

## 回滚

见 `README.md` 的 Rollback 一节:删 compose 服务、删 `run-all.sh` 里那一段、把 `enabled` 改回 `false`。
`data/` 与 `secrets/` 留在宿主机,重新启用不用再登录。
