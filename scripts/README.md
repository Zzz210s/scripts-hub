# 脚本索引

五个脚本:三个 bash **交互式向导**、两个 bash **同步工具**(都不是无人值守任务),加一个 Node
**漂移检测**。用法:`bash scripts/<脚本名>.sh` 或 `node scripts/<脚本名>.mjs`。

同步工具把两个没有 origin 的权威工作区发布成本仓库里的项目快照,工作模型见
`../docs/workspace-model.md`。

| 脚本 | 干什么 | 什么时候用 | 关键说明 |
| --- | --- | --- | --- |
| `oracle-setup-wizard.sh` | 一步步开通 Oracle Cloud Always Free ARM 主机:注册、建实例、放行两层防火墙、写 `~/.ssh/config`、验证连通 | 云迁移时(目前卡在注册,见 `../docs/cloud-vm.md`) | 值持久化到 `~/.config/automation-suite/vm.env`;可随时 Ctrl-C,重跑记住已存的值 |
| `public-reset-wizard.sh` | 删掉旧名仓库并以新名重建为 PUBLIC(只有删库重建才真正清掉旧对象),然后复核推送 | 一次性:本仓库从 `home-automation-configs` 更名为 `scripts-hub` 时用过 | 删库不可逆,要求先有可用镜像备份;`OLD_SLUG` 已 404、新库已存在,现在重跑会走幂等路径 |
| `sync-weread-signin.sh` | 把本机开发克隆 `%WEREAD_DIR%` 的已跟踪文件同步成仓库 `weread-signin/` 的快照 | 每次改完微信读书代码、准备提交前 | 只复制 `git ls-files` 列出的文件;`--dry-run` 只报告差异;README 顶部快照说明每次重写 |
| `sync-microsoft-rewards.sh` | 把权威工作区 `%REWARDS_DIR%` 的已跟踪文件同步成仓库 `microsoft-rewards/` 的快照 | 每次改完微软积分代码或运行器、准备提交前 | 只复制 `git ls-files` + 白名单 `config.json`;跳过 `patches/`;去本机化 + 按机器私有清单脱敏;`--dry-run` 只报告差异 |
| `check-wecom-drift.mjs` | 比对三份企业微信发送实现里 `wecom-core` 核心块是否逐字节一致 | 改过任一份企业微信发送核心后,提交前 | `node scripts/check-wecom-drift.mjs` 不一致退出 1;`--verbose` 打印块大小;权威是 `wecom-notify/src/wecom.js` |

## 路径与凭据

脚本不写死盘符。它们默认读机器私有文件 `~/.config/automation-suite/local-paths.env`
(在仓库之外,永不入库),也接受环境变量覆盖:

| 变量 | 作用 |
| --- | --- |
| `WEREAD_SIGNIN_DIR` / `REWARDS_DIR` | 微信读书、微软积分的权威工作区路径 |
| `HOME_AUTOMATION_CONFIGS_DIR` | 本仓库本地路径 |
| `SENSITIVE_PATTERNS_FILE` | 换一个私有个人标识清单位置(默认 `~/.config/automation-suite/sensitive-patterns.txt`);`sync-microsoft-rewards.sh` 找不到它就直接报错退出 |
| `HAC_BACKUP_GLOB` / `HAC_BACKUP_OLD_GLOB` | 删库前的镜像备份 glob(新名优先、旧名兼容) |
| `AUTOMATION_LOCAL_PATHS` | 换一个私有的 local-paths 文件位置 |

`local-paths.env` **不是**凭据文件(具体凭据清单见 `../docs/credentials.md`)。文件名与目录名
`automation-suite` 是历史遗留值,改了本机脚本就失效,保持不动。

## 改动这些脚本时

- `sync-weread-signin.sh` 的 `KEEP` 列表决定快照目录里哪些文件不被同步触碰。往 `weread-signin/`
  放手写文件会让快照目录不再「纯生成」,应改放到 `machine/` 或 `docs/`。
- `sync-microsoft-rewards.sh` 的 `KEEP`/`SKIP`/`EXTRA`/`RENAMES` 是一张显式清单:`KEEP` 是本目录
  自维护、不写不删的文件,`SKIP` 是源仓库里不发布的路径前缀,`EXTRA` 是源仓库未跟踪但要发布的文件,
  `RENAMES` 是路径改名。脱敏标识从不写进脚本,而是运行时从机器私有 `sensitive-patterns.txt` 读;
  **找不到该文件或脱敏规则自检失败时脚本会拒绝同步**,不要为了省事跳过这个防线。
- `public-reset-wizard.sh` 与 `oracle-setup-wizard.sh` 顶部是跨向导共用的库段(`# ───` 之上),
  改行为改库段,改步骤在 `STAGES` 之下。
- 提交前 `bash -n scripts/*.sh` 与 `shellcheck scripts/*.sh` 都应无输出;`node scripts/check-wecom-drift.mjs`
  与 `node --check scripts/check-wecom-drift.mjs` 应通过。
