# QUICKSTART:从零到跑起来

四步:填 `.env`、只读体检、真跑一次、验证通过再开 `enabled`。离线测试不需要任何凭据。

## 0. 前置条件

- Node.js >= 20.11。运行器零依赖,不需要 `npm install`。
- 服务器部署时能 `docker build` 与 `docker compose`。
- 一个独立的企业微信群机器人 webhook。不同程序用不同群、不同 key。没有它程序照跑,只是不推送。

## 1. 填 `.env`

在程序目录旁边建 `.env`,写进账号:

```
cat > .env <<'EOF'
ACCOUNT_1_BDUSS=<第 1 个账号的 BDUSS>
ACCOUNT_1_NAME=<第 1 个账号的显示名>
ACCOUNT_1_STOKEN=<可选的 STOKEN>
EOF
chmod 600 .env
```

- `ACCOUNT_n_BDUSS` 是必需键,`n` 从 1 开始,可以有多个账号。按 `n` 的数值升序处理。
- `BDUSS` 从浏览器取:登录 `tieba.baidu.com` 后打开该站点的 cookie,复制 `BDUSS` 那一项的值。
- 服务器上程序目录是 `/srv/apps/automation/tieba`,`secrets/wecom-webhook.txt` 里放 webhook 地址,
  权限 600。仓库里不放 webhook 的 key;文档只记路径。

## 2. 只读体检

```
cd proj-baidu-tieba
node src/cli.js check
```

服务器上用容器:

```
docker compose -f /srv/apps/automation/compose.yaml run --rm -T tieba-run check
```

`check` 不写状态、不发送、不签到。它会打印每个账号的 `tbs` 是否可取、关注的吧数量、今天已签的
吧数量,最后给一条对账结论。有账号取不到 `tbs` 或关注列表时退出码为 1,可以据此做部署巡检。

## 3. 真跑一次

先预览,不会联网、不落盘、不发送:

```
node src/cli.js run --dry
```

确认输出里的账号、日期、动作都对了,再真跑:

```
node src/cli.js run
```

服务器上真跑一次:

```
docker compose -f /srv/apps/automation/compose.yaml run --rm -T tieba-run
```

真跑会签到、读回核对、落状态,并发一条 `start` 与一条 `result` 到企业微信。看到 `result` 的
标题写 `运行成功`、正文里有 `对账:通过` 才算这次真的成了。

## 4. 验证通过后再开 `enabled`

**在此之前不要打开调度。** 默认 `config/schedule.json` 里 `baidu-tieba` 是关闭的。

- Linux:把 `baidu-tieba` 的 `linuxEnabled` 改成 `true`;该键缺省时回落到 `enabled`。
- Windows:把 `enabled` 改成 `true`,再 `node scripts/apply-schedule.mjs --apply --yes`。

打开后,Linux 侧由 `run-all.sh` 按 `order` 顺序调到 `tieba/run.sh`,套件一天两次触发。程序自己
用守卫判断该不该真跑:当天已完成、同伴在跑、安静时段都只写日志。

## 出错时看哪

| 现象 | 原因与处理 |
| --- | --- |
| 企业微信收到「需要你处理 · 还没有配置可用的账号凭据」 | `.env` 里还没有可用的 `ACCOUNT_n_BDUSS`。回到第 1 步。 |
| 企业微信收到「需要你处理 · 全部账号的凭据都已失效」 | `BDUSS` 过期了。重新登录贴吧,把新值写进 `.env`。 |
| 日志里 `[跳过] done-today` | 今天已经成功签过,第二次触发按设计静默跳过。 |
| 日志里 `[跳过] peer-running` | 同伴程序在跑,或者单实例锁还在。等下一次触发。 |
| `result` 写 `对账:未能核对` | 关注列表没取到。看运行日志里账号与接口返回,下一次触发会重新核对,当天不会标记完成。 |
| `result` 写 `未签:` 列出若干吧 | 那些吧这次没签上。程序不锁当天,下一次触发会自动重试。 |
| 通知一直没到 | 检查 `secrets/wecom-webhook.txt` 是否存在、权限是否 600。`check` 与 `--dry` 都不推送。 |

## 回滚

见 `README.md` 的 Rollback 一节:删 compose 服务、删 `run-all.sh` 里那一段、把 `enabled` 改回
`false`。`data/`、`logs/` 与 `secrets/` 留在宿主机,重新启用不用再配置一遍。
