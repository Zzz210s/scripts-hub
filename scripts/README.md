# 脚本索引

`scripts/` 下的脚本按**动词前缀**统一命名,一眼能看出它会做什么:

| 前缀 | 含义 | 交互性 |
| --- | --- | --- |
| `wizard-*` | 交互式向导:一步步带你做需要人工判断的事 | 交互,可 Ctrl-C 续跑 |
| `sync-*` | 把权威工作区的已跟踪文件发布成仓库里的项目快照 | 非交互,幂等,带 `--dry-run` |
| `setup-*` | 从全新克隆自检某个项目能不能跑(装依赖 / 建模板 / 跑测试 / 干跑) | 非交互,可重复跑,退出码即结论 |
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

## 自检引导(全新克隆到能跑)

每个项目一份,前置条件、三条命令、凭据清单、验证方式与常见失败都写在项目目录的 `QUICKSTART.md`。

| 脚本 | 检查什么 | 会不会联网 |
| --- | --- | --- |
| `setup-weread-signin.sh` | Node >= 20.11、Python、`.env`/`config.yaml` 模板、`secrets/` 凭据、底座 vendor、218 条离线测试、本地 `status` 干跑 | 默认不联网;`--vendor` 才克隆底座 |
| `setup-microsoft-rewards.sh` | Node >= 24、`npm ci`、patchright chromium、`.env` 模板、`npm run build`、26 条离线测试 | 默认联网(依赖与浏览器);`--no-install --no-browser --no-build` 可只跑离线测试 |
| `setup-autovisor.sh` | `configs.ini` 是否存在、课程链接是否受支持、账号密码是否留空、程序本体是否解压 | 不联网 |

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

## 改动这些脚本时

- `sync-weread-signin.sh` 的 `KEEP` 列表决定快照目录里哪些文件不被同步触碰(现在只有 `SNAPSHOT.txt`
  与 `QUICKSTART.md`)。往 `proj-weread-signin/` 放手写文件会让快照目录不再「纯生成」,应改放到 `machine/`
  或 `docs/`。
- `sync-microsoft-rewards.sh` 的 `KEEP`/`SKIP`/`EXTRA`/`RENAMES` 是一张显式清单:`KEEP` 是本目录
  自维护、不写不删的文件,`SKIP` 是源仓库里不发布的路径前缀,`EXTRA` 是源仓库未跟踪但要发布的文件,
  `RENAMES` 是路径改名。脱敏标识从不写进脚本,而是运行时从机器私有 `sensitive-patterns.txt` 读;
  **找不到该文件或脱敏规则自检失败时脚本会拒绝同步**,不要为了省事跳过这个防线。
- `wizard-public-reset.sh` 与 `wizard-oracle.sh` 顶部是跨向导共用的库段(`# ───` 之上),
  改行为改库段,改步骤在 `STAGES` 之下。
- 提交前 `bash -n scripts/*.sh` 与 `shellcheck scripts/*.sh` 都应无输出;`node --check scripts/*.mjs`
  与 `node scripts/check-wecom-drift.mjs`、`node scripts/check-privacy.mjs` 应通过。
