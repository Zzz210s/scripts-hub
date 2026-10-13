# 网易云音乐签到 · 快速上手

四步,从零到跑通。全程只在最后一步才真的改账号状态。

## 1. 填 `.env`

在 `proj-netease-cloud/` 目录下建 `.env`:

```
ACCOUNT_1_MUSIC_U=<在 music.163.com 登录后,浏览器 cookie 里的 MUSIC_U 值>
ACCOUNT_1_NAME=<给自己看的名字>
```

企业微信通道单放一个文件,一行,权限收紧:

```
mkdir -p secrets && printf '%s' '<你的群机器人 webhook>' > secrets/wecom-webhook.txt
chmod 600 secrets/wecom-webhook.txt .env
```

`MUSIC_U` 是完整登录凭据,按密码对待;`.env` 与 `secrets/` 都已在 `.gitignore` 里。

## 2. 先只读探针,确认字段

```
node src/cli.js probe
```

它只做**读**:签到状态、云贝余额,并打印每条接口的返回形状。**绝不调用签到接口**,也不写状态。
这一步是为了在动真格之前,把「结果落在哪个字段」用你自己的账号确认一遍。

## 3. 预览,再真跑一次

```
node src/cli.js run --dry     # 只打印将要推送的消息 · 不联网、不写状态
node src/cli.js run           # 真跑一次:VIP 乐签 + 读回校验
```

跑完看两处:

- 企业微信里那条 `运行结果`:标题是 `网易云音乐签到 · <账号> · <日期> · 运行成功`,
  正文里才有乐签结论与云贝余额。**标题写「运行成功」不等于签到生效** —— 要看正文那一行。
- `data/state.json` 的当天记录:`ok` 为真才说明业务结果确认已签。

如果换来的是一条 `需要你处理`,按它写的原因做:cookie 失效就去重新登录换 `MUSIC_U`;
限流就等第二天 —— 程序当天会熔断,不会重试。

## 4. 验证通过后再开调度

默认是关的。确认第 3 步没问题后,把 `config/schedule.json` 里 `netease-cloud` 的 `enabled` 改成 `true`,
在服务器上跑一次 `node scripts/apply-schedule.mjs --dry-run` 看槽位顺序,再 `--apply --yes` 生效。

在那之前,程序不会在 08:00 / 12:00 的编排里被调用 —— 这是刻意的:没验证过的程序不接进自动编排。

## 出问题时先看哪里

```
logs/last-run.log      这一次到底做了什么
logs/runner.log        宿主侧记账:退出码、看门狗
data/history.jsonl     逐次运行的结构化记录 · report 的数据源
```

`node src/cli.js report` 重新渲染当天结果;`node src/cli.js check` 是可给监控用的只读体检。

## 不要做的事

- 不要把这个程序的凭据搬到另一台机器上跑:换出口 IP 本身就是风险信号。
- 不要给它加写操作(听歌打卡、评论、分享、音乐人任务):本项目范围只有读与签到,
  这也是它唯一还能自称可审计的地方。
