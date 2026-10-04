# 脚本索引

`scripts/` 下的脚本按**动词前缀**统一命名,一眼能看出它会做什么:

| 前缀 | 含义 | 交互性 |
| --- | --- | --- |
| `wizard-*` | 交互式向导:一步步带你做需要人工判断的事 | 交互,可 Ctrl-C 续跑 |
| `sync-*` | 把权威工作区的已跟踪文件发布成仓库里的项目快照 | 非交互,幂等,带 `--dry-run` |
| `deploy-*` | 把仓库里的项目快照刷回本机工作区,并体检本机部署 | 非交互,默认 `--dry-run`,`--apply` 才写 |
| `setup-*` | 从全新克隆自检某个项目能不能跑(装依赖 / 建模板 / 跑测试 / 干跑) | 非交互,可重复跑,退出码即结论 |
| `apply-*` | 把用户改的配置渲染成实际动作(由 `config/schedule.json` 生成/注册计划任务与 timer) | 非交互,默认 `--dry-run`,`--apply --yes` 才写本机 |
| `check-*` | 只读检查,命中不一致或敏感内容就退出 1 | 非交互,可进 CI 或提交前钩子 |

用法一律 `bash scripts/<脚本名>.sh` 或 `node scripts/<脚本名>.mjs`。

## 向导

| 脚本 | 干什么 | 什么时候用 | 关键说明 |
| --- | --- | --- | --- |
| `wizard-oracle.sh` | 一步步开通 Oracle Cloud Always Free ARM 主机:注册、建实例、放行两层防火墙、写 `~/.ssh/config`、验证连通 | 云迁移时(目前卡在注册,见 `../docs/cloud-vm.md`) | 值持久化到 `~/.config/automation-suite/vm.env`;可随时 Ctrl-C,重跑记住已存的值 |
| `wizard-public-reset.sh` | 删掉旧名仓库并以新名重建为 PUBLIC(只有删库重建才真正清掉旧对象),然后复核推送 | 一次性:本仓库从 `home-automation-configs` 更名为 `scripts-hub` 时用过 | 删库不可逆,要求先有可用镜像备份;`OLD_SLUG` 已 404、新库已存在,现在重跑会走幂等路径 |

## 同步

| 脚本 | 干什么 | 什么时候用 | 关键说明 |
| --- | --- | --- | --- |
| `sync-weread-signin.sh` | 把本机开发克隆 `%WEREAD_DIR%` 的已跟踪文件同步成仓库 `proj-weread-signin/` 的快照 | 每次改完微信读书代码、准备提交前 | 只复制 `git ls-files` 列出的文件;`KEEP` 里的 `QUICKSTART.md` 不被触碰;README 顶部快照说明每次重写 |
| `sync-microsoft-rewards.sh` | 把权威工作区 `%REWARDS_DIR%` 的已跟踪文件同步成仓库 `proj-microsoft-rewards/` 的快照 | 每次改完微软积分代码或运行器、准备提交前 | 只复制 `git ls-files` + 白名单 `config.json`;跳过 `patches/`;去本机化 + 按机器私有清单脱敏;`--dry-run` 只报告差异 |

## 部署(把快照刷回本机)

从仓库恢复/刷新本机工作区,并体检本机部署(凭据、运行时、计划任务)。默认 `--dry-run` 只报告,
`--apply` 才写文件;**不碰计划任务**,只检查并给出注册命令。`--dest=<目录>` 可写到别处(验证用)。

用途是**换机恢复**:快照是脱敏发布件(本机路径 → 占位符、个人标识 → `sample`),把它写回权威工作区会把
占位符带回去。所以工作区 HEAD 与快照源提交一致时脚本判“同源”、跳过刷新,`--apply` 直接报错;
日常刷新用 `sync-*` 走反方向。确需反向覆盖一份同源工作区时加 `--allow-authoritative`(旧名 `--force`,
现等同):它会先逐文件预览 `新增/覆盖/跳过/保留`、再警告这是有损覆盖、要求交互输入 `yes`
(非交互必须再加 `--yes`),执行前把被覆盖文件备份到 `~/.config/automation-suite/backups/<快照名>-<时间戳>/`
并打印恢复命令。共享实现拆在 `scripts/lib/deploy-common.sh`(参数/同源检测)与 `scripts/lib/deploy-plan.sh`
(文件计划/备份/确认),两个 `deploy-*.sh` 都 source 它们。

| 脚本 | 干什么 | 什么时候用 | 关键说明 |
| --- | --- | --- | --- |
| `deploy-weread-signin.sh` | 把 `proj-weread-signin/` 刷进 `%WEREAD_DIR%`,检查 `.env`/`config.yaml`/`secrets`/底座/Node/`WeReadSignIn` | 换机恢复、同步后刷新工作区 | 只回写源仓库本来就有的文件;不改工作区里的 `.env`、`secrets/`、`vendor/` |
| `deploy-microsoft-rewards.sh` | 把 `proj-microsoft-rewards/` 刷进 `%REWARDS_DIR%`,检查 `.env`/webhook/`sessions`/浏览器/`dist`/`MicrosoftRewardsScript`/`AutoShutdown0200` | 换机恢复、同步后刷新工作区 | 合集层文件(README/QUICKSTART/SNAPSHOT)不部署;快照 `README.upstream.md` 还原成工作区 `README.md`;工作区已有的 `config.json` 绝不覆盖 |

本机现状盘点与恢复步骤见 [`../docs/local-deployment.md`](../docs/local-deployment.md)。

## 自检引导(全新克隆到能跑)

每个项目一份,前置条件、三条命令、凭据清单、验证方式与常见失败都写在项目目录的 `QUICKSTART.md`。

| 脚本 | 检查什么 | 会不会联网 |
| --- | --- | --- |
| `setup-weread-signin.sh` | Node >= 20.11、Python、`.env`/`config.yaml` 模板、`secrets/` 凭据、底座 vendor、218 条离线测试、本地 `status` 干跑 | 默认不联网;`--vendor` 才克隆底座 |
| `setup-microsoft-rewards.sh` | Node >= 24、`npm ci`、patchright chromium、`.env` 模板、`npm run build`、26 条离线测试 | 默认联网(依赖与浏览器);`--no-install --no-browser --no-build` 可只跑离线测试 |
| `setup-autovisor.sh` | `configs.ini` 是否存在、课程链接是否受支持、账号密码是否留空、程序本体是否解压 | 不联网 |

## 调度(时间来自 `config/schedule.json`)

触发时刻不写死在注册脚本里:改 `config/schedule.json`(字段说明与默认值在
`config/schedule.example.json` 的 `_readme`),再跑一遍下面这个。约定见 `../docs/scheduling-convention.md` 第 0 节。

| 脚本 | 干什么 | 什么时候用 | 关键说明 |
| --- | --- | --- | --- |
| `apply-schedule.mjs` | 按配置生成 Windows 任务 XML 与 systemd timer;`--apply --yes` 真注册(Windows) | 改完时间、换机恢复、加新程序 | 默认 `--dry-run` 只打印;`--dest=<目录>` 落盘生成物,`--emit=windows\|systemd\|both`、`--only=<程序id>` 收窄;动作路径的 `%REWARDS_DIR%` 类占位符从机器私有的 `local-paths.env` 展开,填不了时 `--apply` 直接拒绝 |
| `lib/schedule.mjs` | 读 + 校验 + 归一化配置;库,兼一个只读小 CLI(`show` / `expect` / `json`) | 被 `apply-schedule.mjs` 与 `deploy-*.sh` 调用 | `startTime` / `logonDelayMinutes` 写 `auto` 就在这按 `order` 与 `stagger` 推导 |
| `lib/schedule-targets.mjs` | 生成物(XML / unit)与动作路径解析 —— 纯函数 | 同上 | 不读写任何本机文件,便于干跑与测试 |

`deploy-*.sh` 第 6 步会拿 `expect` 的输出与**本机任务的实际触发器**逐项比对,不一致报 `[缺]`。

## 检查

| 脚本 | 干什么 | 什么时候用 | 关键说明 |
| --- | --- | --- | --- |
| `check-wecom-drift.mjs` | 比对两份企业微信发送实现(`proj-microsoft-rewards/wechat-bridge/lib/wecom.js` 与 `proj-weread-signin/src/notify.js`)里 `wecom-core` 核心块是否彼此逐字节一致 | 改过任一份企业微信发送核心后,提交前 | `node scripts/check-wecom-drift.mjs` 不一致退出 1;`--verbose` 打印各块大小与差异位置;规则见 `../docs/wecom-rules.md` |
| `check-privacy.mjs` | 扫 `git ls-files` 的每个文件:本机路径、真实邮箱、`wrk-` 真 key、webhook 真 key、手机号、机器私有标识清单里的词 | 提交前、发布前,或定期体检 | `node scripts/check-privacy.mjs` 命中退出 1;`--verbose` 打印规则数;私有清单读 `SENSITIVE_PATTERNS_FILE`(默认 `~/.config/automation-suite/sensitive-patterns.txt`),读不到只跑通用规则 |

## 路径与凭据

脚本不写死盘符。它们默认读机器私有文件 `~/.config/automation-suite/local-paths.env`
(在仓库之外,永不入库),也接受环境变量覆盖:

| 变量 | 作用 |
| --- | --- |
| `WEREAD_SIGNIN_DIR` / `REWARDS_DIR` | 微信读书、微软积分的权威工作区路径 |
| `HOME_AUTOMATION_CONFIGS_DIR` | 本仓库本地路径 |
| `SENSITIVE_PATTERNS_FILE` | 换一个私有个人标识清单位置(默认 `~/.config/automation-suite/sensitive-patterns.txt`);`sync-microsoft-rewards.sh` 找不到它就直接报错退出,`check-privacy.mjs` 找不到则只跑通用规则 |
| `HAC_BACKUP_GLOB` / `HAC_BACKUP_OLD_GLOB` | 删库前的镜像备份 glob(新名优先、旧名兼容) |
| `AUTOMATION_LOCAL_PATHS` | 换一个私有的 local-paths 文件位置 |

`local-paths.env` **不是**凭据文件(具体凭据清单见 `../docs/credentials.md`)。文件名与目录名
`automation-suite` 是历史遗留值,改了本机脚本就失效,保持不动。

触发时间写在仓库里的 `config/schedule.json`(与机器私有目录无关:它是可提交的调度约定,不含凭据);
换一个位置/文件名用 `HAC_SCHEDULE_FILE` 覆盖。

两个机器私有文件都有模板:复制 `scripts/local-paths.env.example` 到 `~/.config/automation-suite/local-paths.env`,
复制 `scripts/sensitive-patterns.txt.example` 到 `~/.config/automation-suite/sensitive-patterns.txt` 并填自己的标识。
缺 `sensitive-patterns.txt` 时 `sync-microsoft-rewards.sh` **拒绝同步** —— 这是安全属性,不要绕过。

## 改动这些脚本时

- `sync-weread-signin.sh` 的 `KEEP` 列表决定快照目录里哪些文件不被同步触碰(现在只有 `SNAPSHOT.txt`
  与 `QUICKSTART.md`)。往 `proj-weread-signin/` 放手写文件会让快照目录不再「纯生成」,应改放到 `docs/`。
- `sync-microsoft-rewards.sh` 的 `KEEP`/`SKIP`/`EXTRA`/`RENAMES` 是一张显式清单:`KEEP` 是本目录
  自维护、不写不删的文件,`SKIP` 是源仓库里不发布的路径前缀,`EXTRA` 是源仓库未跟踪但要发布的文件,
  `RENAMES` 是路径改名。脱敏标识从不写进脚本,而是运行时从机器私有 `sensitive-patterns.txt` 读;
  **找不到该文件或脱敏规则自检失败时脚本会拒绝同步**,不要为了省事跳过这个防线。
- `wizard-*.sh` 只留流程编排与阶段跳转(阶段在 `STAGES` 标记之下)。输出/交互/值持久化在
  `lib/wizard-common.sh`(两个向导共用);`wizard-public-reset.sh` 的路径与敏感模式配置在
  `lib/reset-common.sh`、备份/SHA/topics 校验在 `lib/reset-verify.sh`、GitHub 动作与推送后校验在
  `lib/reset-gh.sh`。改向导通用行为改库段,不要在单个向导里另写一份。
- `scripts/lib/` 是 `deploy-*.sh` 共用的片段:`deploy-common.sh` 管输出/参数/同源检测/授权闸门/任务触发器读取,
  `deploy-plan.sh` 管文件计划/备份/二次确认/落盘。改部署行为改这两处,不要在单个 `deploy-*.sh` 里另写一份。
- 提交前 `bash -n scripts/*.sh scripts/lib/*.sh` 与 `shellcheck scripts/*.sh scripts/lib/*.sh` 都应无输出;
  `node --check scripts/*.mjs scripts/lib/*.mjs` 与 `node scripts/check-wecom-drift.mjs`、`node scripts/check-privacy.mjs` 应通过;
  `node scripts/apply-schedule.mjs --dry-run` 应能把默认配置渲染成触发器(不改本机任务)。
