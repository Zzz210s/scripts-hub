# 微软积分自动化

每天自动跑 Microsoft Rewards(搜索、活动、读文章),算完分推送结果到企业微信。

| | |
| --- | --- |
| 程序本体 | 上游 [`TheNetsky/Microsoft-Rewards-Script`](https://github.com/TheNetsky/Microsoft-Rewards-Script) v4.3.2(GPL-3.0)+ `../patches/microsoft-rewards/` 的三个补丁 |
| 权威工作区 | `%REWARDS_DIR%`(本机本地 git 仓库,只有 upstream 远端,没有自己的 origin) |
| 本目录 | 那个工作区已跟踪文件的**同步快照**(`../scripts/sync-microsoft-rewards.sh` 生成),本仓库就是它的远程落点 |
| 装在哪 | `%REWARDS_DIR%`(路径约定见仓库根 README) |
| 跑在哪台机器 | 本机 Windows |
| 什么时候跑 | 计划任务 `MicrosoftRewardsScript`:登录后 3 分钟(其后 1 小时内每 10 分钟重试)+ 每天 08:00 起每 2 小时一次(14 小时窗口),一天最多 3 次尝试 |
| 许可 | GPL-3.0(上游 `LICENSE` 一并同步;本仓库整体也是 GPL-3.0) |

**不要直接改这个目录里的代码。** 它是生成快照:改动先落在权威工作区 `%REWARDS_DIR%`
(在那提交),再跑 `bash scripts/sync-microsoft-rewards.sh`,然后在本仓库提交推送。取快照的源提交记录在
`SNAPSHOT.txt`;上游原版 README 同步为 `README.upstream.md`。完整工作模型见
[`../docs/workspace-model.md`](../docs/workspace-model.md)。

## 本目录有什么

| 文件 / 目录 | 说明 |
| --- | --- |
| `src/` | 上游 TypeScript 源码 + 三个本地补丁落下的改动;改完要 `npm run build` |
| `scripts/windows/` | **本项目的运行器**:触发入口、单实例与配额判定、内存闸门、看门狗、关机任务、安装脚本 |
| `scripts/windows/README-autostart.md` | 运行器的详细说明(任务、状态文件、日志、命令、升级步骤) |
| `scripts/api/`、`scripts/docker/`、`scripts/nix/`、`scripts/main/` | 上游自带的 Web 控制台、容器、Nix、维护脚本(本机未用) |
| `wechat-bridge/` | 企业微信通知层(开始/结束/跳过/需要你处理四类消息、低分归因、结果排版) |
| `config.json` | 实际使用的程序配置(不含凭据);源仓库里它未跟踪,由同步脚本按白名单发布 |
| `config.example.json` / `env.example` | 上游原版模板 |
| `package.json` / `package-lock.json` / `tsconfig.json` | 上游依赖清单与构建配置 |
| `.github/` | 上游自带的 CI(发布、格式化);嵌套在子目录里 GitHub 不会执行,仅作为项目完整性保留 |
| `README.upstream.md` | 上游 v4.3.2 的原版 README(完整配置项说明看这份) |
| `SNAPSHOT.txt` | 同步元信息:源提交、发布文件数、排除与改写规则 |

上游补丁在 `../patches/microsoft-rewards/`(**不在本目录**,避免两处维护);升级上游后按文件名顺序
`git apply`。

`wechat-bridge/` 的企业微信发送核心与 `../wecom-notify/src/wecom.js` 的 `wecom-core` 块必须逐字节一致:
改任一处后跑 `node scripts/check-wecom-drift.mjs`。权威实现是 `wecom-notify`;本目录只允许外壳
(消息排版、webhook 读取、返回形状)不同。

## 依赖

- Node.js >= 24(实测 v24.14.0)
- 上游依赖(Playwright 驱动浏览器、SQLite 存登录态等),`npm install` 由上游管理
- 构建:`npm run build`(输出到 `dist/`,被 `.gitignore` 忽略,不入本仓库)

## 需要哪些凭据

| 文件 | 填什么 |
| --- | --- |
| `%REWARDS_DIR%\.env` | 每个账号的邮箱与密码(`ACCOUNT_N_EMAIL` / `ACCOUNT_N_PASSWORD`),可选 `_GEO_LOCALE`、`_LANG_CODE`、`_TOTP_SECRET`、`_SAVE_FINGERPRINT_*` |
| `%REWARDS_DIR%\wechat-bridge\data\wecom-webhook.txt` | 企业微信群机器人 webhook |

模板是 `env.example`。真实值只在 `%REWARDS_DIR%` 里,仓库里只有模板。去哪拿、有效期与恢复方式见
`../docs/credentials.md`。

## 关键配置项(当前值)

| 项 | 值 | 说明 |
| --- | --- | --- |
| `clusters` | 由运行器按可用内存自适应写回 | 可用内存 ≥2500MB 用 2(并行),1200-2499MB 降为 1,<1200MB 直接跳过本次 |
| `headless` | true | 无窗口运行 |
| `searchSettings.searchDelay` | 20-40 秒 | 桌面搜索节奏 |
| `searchSettings.readDelay` | 15-30 秒 | 读文章节奏(10 篇/账号) |
| `workers.doBonusSearches` | false | 加成搜索实测 0 分,已关 |
| `workers.doVisualSearch` | true | 视觉搜索(部分账号/区域不提供,会自行跳过) |
| `scrollRandomResults` / `clickRandomResults` | true | 模拟滚动与随机点击 |
| `debugLogs` | 按需开启 | 只吃磁盘,不吃内存 |

完整配置项说明在上游文档:`README.upstream.md` 与 `scripts/api/README.md`。

## 调度与守卫

- 逻辑日以 **04:00** 为界:凌晨的运行计入前一天,保证开机后那次必定是新一天的第一跑。
- 每次触发要过守卫:内存不足跳过、当天已完成跳过、安静时段(默认 20:00-23:00)与关机前 30 分钟跳过。
- 单实例锁 `logs\run.lock`,判定以进程实况为权威,残留锁立即回收。
- 看门狗默认 150 分钟,超时强杀并通知,当天剩余触发会重试未完成的账号。
- 完整约定见 `../docs/scheduling-convention.md`。

## 通知(企业微信)

每次运行推送开始提醒与结束结果:逐账号本次/今日得分与累计、总耗时;失败时附失败原因;**低分账号会附
归因**(例如「运行前桌面搜索已无可赚积分;搜索阶段被判定为已完成而跳过」)。消息类型与文案规则见
`../docs/notification-convention.md`。

## 测试

- 通知层:`node --test wechat-bridge/test/*.test.js`(21 条)
- 逻辑日/运行器:`node --test scripts/windows/run-state.test.js`(5 条)
- 企业微信发送核心一致性:`node scripts/check-wecom-drift.mjs`

## 日志与状态(都在 `%REWARDS_DIR%` 下,不入本仓库)

| 路径 | 含义 |
| --- | --- |
| `logs\last-run.log` / `previous-run.log` | 本次与上一次完整日志(轮转) |
| `logs\last-run.state` | `YYYY-MM-DD N`,N=9 表示当天已完成 |
| `logs\runner.log` | 只追加的守卫记录(跳过原因、残留锁回收、通知结果) |
| `logs\run.lock` | 单实例锁,判定以「是否有 node 在跑 `dist\index.js`」为权威 |
| `logs\shutdown.log` | 关机任务日志 |
| `sessions\sessions.db` | 各账号登录态与指纹(SQLite) |

## 常见问题

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| 某账号只涨十几分 | 运行前当天配额已被领完(可能你在别的设备上用过),不是脚本故障 | 看企业微信推送的「低分原因」一行;必要时调整该账号的 App 侧任务 |
| 登录失败且提示密码错误 | `.env` 里密码不对(注意别把 6 位 PIN 当密码) | 换成真实密码;或配置 TOTP |
| 提醒「需要验证」 | Microsoft 2FA 挑战 | 手动批准一次;或配置 TOTP |
| 运行被强杀 | 看门狗超时(默认 150 分钟)或系统关机 | 看 `logs\runner.log` 的 `[WATCHDOG]` 行;当天剩余触发会自动重试 |
| 开机后迟迟不跑 | 凌晨的运行已把当天标记为完成;或内存不足被闸门跳过 | 看 `logs\runner.log`;内存不足时当天只推一次提醒、不消耗尝试次数 |

## 升级上游

```bash
cd "%REWARDS_DIR%"
git fetch upstream && git merge upstream/main      # 或重下 release 覆盖
git apply <hub>/patches/microsoft-rewards/*.patch  # 按文件名顺序
npm install && npm run build
```

`dist/` 被上游 `.gitignore` 忽略,改完 `src` 必须 `npm run build`。改完在 `%REWARDS_DIR%` 提交,
再回本仓库跑 `bash scripts/sync-microsoft-rewards.sh` 并提交快照。

## 相关文档

- 工作模型(权威工作区、同步流程、为什么不建独立仓库):`../docs/workspace-model.md`
- 运行器细节:`scripts/windows/README-autostart.md`
- 上游原版说明:`README.upstream.md`
- 调度约定:`../docs/scheduling-convention.md`
- 通知约定:`../docs/notification-convention.md`
- 凭据清单:`../docs/credentials.md`
- 补丁存档:`../patches/README.md`
- 同步脚本:`../scripts/README.md`
