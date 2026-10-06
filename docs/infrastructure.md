# 基础设施:备份 / 通知中间层 / 更新 / 监控

这份文档回答的是「自动化套件之外,还缺什么底座」,不是某个程序怎么跑。
调研来源:笔记库里的 `记录/自动化脚本项目/2026-10-06-可加入的自动化脚本调研.md` 的「强烈建议」档
(备份、通知中间层、更新、监控四项)。**下列结论多数带待决策项,只有明确标注「已做」的才动过本机。**

---

## 0. 一句话结论

| 方向 | 结论 | 状态 |
| --- | --- | --- |
| 备份 | 用 **restic**,清单已升级为**多来源**(本机 + 腾讯云主机),目标建议**跨 provider 对象存储** | 脚本已做并实测,目标待定 |
| 通知中间层 | **不动**现有三份企业微信实现;apprise 只用于新基础设施的告警 | 已评估,不改代码 |
| 更新 | **topgrade 已装**,但要配收窄配置,不能裸跑 | 已装 + 配置模板已实测 |
| 监控 | 建议放**云主机的 docker compose**,不在本机起容器 | 只出方案,不实施 |

---

## 1. 备份

### 1.1 盘清:现在什么东西没有异地副本

判据不是「有没有备份」,而是「**换机/盘坏之后能不能恢复**」。本机(Windows,主机名与用户目录不写进公开仓库)实测:

| 资产 | 体量 | 现在的另一份在哪 | 判定 |
| --- | --- | --- | --- |
| AI 会话 `~/.pi/agent/sessions` | 476MB | 无 | **没有异地副本** |
| magic-context 库 `~/.local/share/cortexkit/magic-context/context.db` | 735MB(+27MB WAL) | 无 | **没有异地副本**,且不可再生 |
| 会话回收站 `~/.pi/agent/sessions-trash` | 33MB | 无 | 没有异地副本 |
| 简报/心跳 `~/.ai-brief-hub`、`~/.ai-sessions` | 5.3MB + 71MB | 无 | 没有异地副本(可重建,低价值) |
| 真实凭据:`~/.pi/agent/auth.json`、`models-store.json`、`~/.opencommit`、`~/.npmrc`、`~/.ssh`、`~/AppData/Roaming/GitHub CLI`、`~/.config/automation-suite`、`~/.config/cortexkit` | 合计 <2MB | 无(仓库里只有 `*.template`) | **没有异地副本**,丢了要逐个重配 |
| 工作区凭据:`%WEREAD_SIGNIN_DIR%/{.env,secrets}`、`%REWARDS_DIR%/.env` | <15KB | 无 | **没有异地副本** |
| 笔记库 `%NOTES_DIR%` | 98MB / 6562 文件 | GitHub `Zzz210s/note`(**public**);本地 `%NOTE_BACKUP_ROOT%` 下的日期快照(见 1.5) | 半个:144 个未提交改动 + 26 个未推提交不在远端;本地快照已改成「一个日期一个目录」并**过了恢复演练**(见 1.5a) |
| 微信读书工作区 `%WEREAD_SIGNIN_DIR%` | 626MB(其中 `.capture/` 621MB 是逆向抓取产物) | 仓库里只有**脱敏快照** | **没有异地副本**(无 origin) |
| 微软积分工作区 `%REWARDS_DIR%` | 172MB | 同上 | **没有异地副本**(无 origin) |
| 本机仓库克隆:`config-ai`、`ai-route`、`ai-session-hub`、`brief-hub`、`pi-codegraph`、`home-automation-configs` | ~19MB | 各有 GitHub origin | 基本算有;`ai-session-hub` 有 11 个未推提交 |
| 现有 bare 镜像 `*backup-*.git`(6 个) | — | 家目录与 `E:` 盘根 | **不算备份**:同一块盘 |

`scripts/backup.mjs --dry-run` 实测(2026-10-06):**29/30 个来源存在,约 2.04 万个文件,1.7GB**。
最大两块就是上面表里前两行的 cortexkit(936MB)与 pi sessions(476MB)。

### 1.2 为什么现有的东西都不能算备份

- **D/E/F 三块盘与 C: 是同一块 NVMe。** `Get-Disk` 显示 D:、E:、F: 都是 `Msft Virtual Disk`,
  `Get-Disk -Number 1,2,3` 的 Location 分别是 C: 盘根下的 `F.vhdx`、`D.vhdx`、`E.vhdx`
  —— 它们是 C: 盘上的虚拟磁盘文件。所以「拷到 E:」防不了盘坏,只防误删。
- **现有 bare 镜像全在本机同一块盘上**(家目录下的 `*backup-*.git` 与 `E:` 盘根下的同名文件)。
- **GitHub 上的 `Zzz210s/note` 是 public 且落后本地 26 个提交**;笔记里含个人内容,
  它同时是「已经公开」和「不完整」两份风险。
- **`E:` 两个工作区没有 origin**,GitHub 上只有 `scripts-hub` 里的脱敏快照(路径被换成占位符,
  不可回灌)。工作区的 `.git`(64 / 36 个提交)是唯一一份完整历史。

### 1.3 选型

| 方案 | 形态 | 加密 | 去重/增量 | Windows | 评估 |
| --- | --- | --- | --- | --- | --- |
| **restic** | 单文件 CLI(Go) | 有,默认 | 有,快照式 | 原生 exe,放进 Git Bash / 计划任务都行 | **选它**。无需常驻进程,`--dry-run` 原生支持,后端可换(rclone / SFTP / S3) |
| kopia | CLI + GUI(Go) | 有 | 有 | 原生,有 GUI | 次选。GUI 对 Windows 友好,但本需求是脚本化,不需要 GUI |
| rclone(裸用) | 同步/复制 | 只有 crypt 远程时 | 无快照概念 | 原生 | **当后端用,不当主备份**。`sync` 会把删除同步过去,不是快照 |
| borg | CLI(Python) | 有 | 有 | 需要 WSL 或社区移植 | 排除:Windows 支持弱于 restic |
| duplicati | GUI + 调度 | 有 | 有 | 桌面级 | 排除:自带 Web GUI 与调度,与「脚本 + 计划任务」的既有形态冲突 |

**组合**:restic 做快照与加密,rclone 只作为可能的云后端(rclone 已装,目前没有任何 remote)。

### 1.4 拓扑:现在到底跑在哪(2026-10-05 只读核实)

备份目标必须先看拓扑,否则很容易把「源」和「备份」放进同一个故障域。实测:

| 程序/资产 | 跑在哪 | 数据(状态/凭据/日志)在哪 | 谁是权威 | 本机(Windows)是否还参与 |
| --- | --- | --- | --- | --- |
| 微软积分 | 腾讯云主机 `62.234.211.51`(Ubuntu 26.04 / 2C4G / 59G 盘)的一次性容器,由 `automation-suite.timer` 08:00 与 12:00 触发 | `/srv/apps/automation/rewards/{.env,config,sessions,wechat-bridge/data,logs}` | **云主机**(`sessions.db` 是登录态,`points-history.json` 是唯一历史) | **否**:本机计划任务 `MicrosoftRewardsScript` 已不存在 |
| 微信读书签到 | 同上,同一个 timer,整轮由 `run-all.sh` 顺序触发 | `/srv/apps/automation/weread/{.env,secrets,data,logs}` | **云主机**(`data/state.json`、`history.json`) | **否**:`WeReadSignIn` 任务已不存在 |
| 本机工作区 `<软件盘>:/weread-signin`、`<软件盘>:/Microsoft-Rewards-Script-4.3.2` | 本机(代码与部署源,目前不再被计划任务调用) | 各自 `.git` 与 logs(最后一次本地运行 2026-10-04) | 本机(唯一完整历史,无 origin) | 是,但只作为代码来源与备份源 |
| Epic 限免 | 本机按需(`EpicFreeGames` 任务当前未注册) | `proj-epic-free-games/secrets` | 本机 | 是 |
| 凭据/会话/记忆/笔记 | 本机 | 见 1.1 表 | 本机 | 是 |

要点:**签到类程序的权威数据已整体搬到云主机**,本机 Windows 只剩代码、凭据与 AI 资产。
所以「备份本机」和「备份云主机」是两件事,不能混成一份清单。

### 1.4a 目标位置选项

核心原则:**跨机器,最好跨 provider**。把云主机备份回它自己(或同账号同区域的另一台)不构成
异地副本 —— 账号欠费/被盗、区域故障、误删会同时带走源与备份。

| 选项 | 成本 | 跨故障域? | 备注 |
| --- | --- | --- | --- |
| **跨 provider 对象存储**(Cloudflare R2 免费 10GB / Backblaze B2 免费 10GB,均支持 S3 协议) | 0(额度内)或几元/月 | 是(与腾讯云不同账号) | **首选**。restic 原生 `s3:` 后端;两台机器各推一个仓库或各用一个 tag |
| 腾讯云 COS(对象存储,S3 兼容) | 约 ¥0.1/GB·月 | 否(同账号) | 次选。比放云主机本机强(不在同一块盘、不在同一台机器),但账号级故障仍会一起带走 |
| 本机 Windows 硬盘 + 移动硬盘/U 盘 | 一次性(¥100-300) | 对云主机是跨机;对本机不是 | 适合当**离线第三份**;`restic` 可对本地目录做仓库,移动盘记得插 |
| 自建 SFTP(另一台 VPS / NAS) | 已有或一次性 | 是 | 可行,但要自己维护那台机器 |

**不要选**:云主机自己的盘(源与备份同机);同账号同区域的另一台云主机(帮助有限);D、E、F 三个盘符(与 C: 同一块 NVMe 的虚拟盘);`Zzz210s/note`(public 且与本地分叉,见 1.1)。

**按机器分开备份**(两份清单,不要合并):

- **腾讯云主机 `62.234.211.51`**:`rewards/{.env,sessions,config,wechat-bridge/data}`、`weread/{.env,secrets,data,config.yaml}`、systemd 单元;代码可从本机重建,`src/vendor` 与镜像不备。合计约 **25MB**。
- **本机 Windows**:`credentials` / `agent-memory`(pi 会话 + `VACUUM INTO` 后的 magic-context)/ `notes`(`F:/0-Note`)/ `workspaces`(`<软件盘>` 两个工作区,去掉 `.capture`)/ `repos`。合计约 **1.1GB**。
- **不备**:`.capture`(621MB 逆向产物)、`~/.ai-sessions`(71MB 心跳,可重建)、`rewards/src/vendor`(115MB Chromium,可重下)、两边的 `logs`(ephemeral)。

### 1.4b 云主机那组:两种模式

| 模式 | 怎么做 | 好处 | 代价 |
| --- | --- | --- | --- |
| **run-on-remote** | 在云主机装 restic,把 `/srv/apps/automation` 推到云外仓库(COS/R2/B2),交给 systemd timer | 不依赖本机在线;云主机 7x24;数据不经本机中转 | 云主机上多一个二进制与一份仓库凭据;云主机被攻破时凭据同机 |
| **pull-over-ssh**(脚本默认支持这条) | 从本机 `rsync` 把云上目录拉到本机暂存,再由本机 restic 推走 | 云主机保持最小,不装 restic、不放仓库凭据;备份任务集中在一处可审计 | 要求本机在线且 SSH 可达;每次拉约 25MB(含 20MB `sessions.db`) |

两者不互斥:可以先用 pull-over-ssh 起步,稳定后再把 run-on-remote 当第二份。

### 1.5 已经做掉的

- `config/backup.json`(version 2)—— **多来源清单**:本机 `sets`(5 个集合:`credentials` /
  `agent-memory` / `notes` / `workspaces` / `repos`)+ `remote` 段(云主机 3 个集合:
  `cloud-credentials` / `cloud-state` / `cloud-code`)。每项写清「为什么它需要被备份」。
  排除项按目录名走:`.capture`、`node_modules`、`.venv`、`__pycache__`、`.codegraph`、
  `ms-playwright`、`logs`、`tmp`、`.cache` 等。
- `prepare` 段:`context.db` 先 `VACUUM INTO` 到 `~/.local/share/automation-suite/backup-staging/`
  再进 `agent-memory`;活库与 `-wal`/`-shm` 不直接进备份。第二个 prepare 步骤 `note-snapshot`
  生成笔记库快照(见下),`--apply` 时先跑 prepare 再调 restic。
- **笔记库快照(2026-10-06 起)**:`scripts/note-snapshot.mjs` 把笔记库收成**一个日期一个目录**:

```
%NOTE_BACKUP_ROOT%/<YYYY-MM-DD>/
  repo.bundle        git bundle --all:全部 refs 与完整历史(单文件,可直接 git clone)
  worktree.tar.zst   工作区全量,只排除 .git;含未跟踪与被 .gitignore 的文件(如 .obsidian/)
  manifest.json      日期 / HEAD / refs / 提交数 / 文件数与字节 / 每件 sha256 / 保留策略
  legacy-meta/       仅迁移那一份有:旧的 diff/status/log 原件
%NOTE_BACKUP_ROOT%/legacy/
  2026-09-23-pre-rewrite-full.bundle   历史重写前的完整历史(head 在当前仓库里已不存在)
  2026-09-23-pre-rename.bundle         重写前另一时间点
  SHA256SUMS.txt
```

  保留策略:只保留最近 **3** 个日期目录(可配),更旧的整目录删;`legacy/` 不动。
  新快照写成功后才清理,且 `manifest.json` 最后写(中断不留半个快照)。
  `notes` 集合(活库,含 `.git` 原样)与新的 `notes-snapshot` 集合**同时存在**:
  前者是活库原样,后者是自包含、不依赖 restic 就能恢复的制品;新增不删旧,上传面只增不减。
- `scripts/backup.mjs` + `scripts/lib/backup.mjs` + `scripts/lib/backup-remote.mjs` +
  `scripts/lib/backup-prepare.mjs` —— 枚举与执行。**默认 `--dry-run`**:不装 restic 也能跑,
  不加 `--remote` 就**不连任何远端**;`--apply` 在没有仓库参数时**故意拒绝执行**(且在写盘之前就拦下)。

```bash
node scripts/backup.mjs                 # 枚举本机会备份什么(已实测)
node scripts/backup.mjs --list          # 看本机 + 云上的集合
node scripts/backup.mjs --json          # 机器可读
node scripts/backup.mjs --set=notes     # 只看一个本机集合
node scripts/backup.mjs --strict        # 本机有路径缺失就退出 1
node scripts/backup.mjs --remote        # 只读 SSH 枚举云上体积(实测可用)
node scripts/backup.mjs --prepare       # 只跑 VACUUM INTO 快照(实测:198MB)
node scripts/backup.mjs --pull          # 只打印从云上拉取的 rsync 命令
node scripts/backup.mjs --pull --apply  # 真拉 + 真推(需 restic 仓库参数)
```

实测(2026-10-05):本机 `29/30 个来源存在,约 2 万个文件,1.1GB,1 个缺失`(缺
`proj-epic-free-games/secrets/`);云上 `29/29 个来源存在,约 5MB 快照量级 + 20MB sessions.db`。
路径与主机地址都不写死:本机盘符走 `%NAME%` 占位符(如 `NOTES_DIR`),云主机走
`%BACKUP_REMOTE_SSH%`(填在机器私有的 `~/.config/automation-suite/local-paths.env`),
所以公开仓库里不会出现本机路径或真实 IP。

### 1.5a 笔记库快照的恢复演练(2026-10-06 实测通过)

快照不是「拷了就完」,`scripts/note-snapshot.mjs --drill` 每次都把三件事验一遍:

| 检查 | 2026-10-05 那份(迁自旧三件) | 2026-10-06 那份(当天生成) |
| --- | --- | --- |
| `git bundle verify` | `is okay`,`records a complete history` | 同左 |
| 全量取回后 `git fsck --full` | 无输出(干净) | 同左 |
| 提交数 / HEAD / 3 个 refs vs 清单 | 495 / `52e062b` / 全部一致 | 612 / `2a5b1b69` / 全部一致 |
| 工作区解包:文件数 / 字节 / 摘要 vs 清单 | 750 / 22381529 / `e06c1fd6d62c` 一致 | 876 / 26508504 / `fd44883c0bd9` 一致 |
| 逐文件 sha256 比对源工作区 | 750 个全一致 | 876 个全一致 |
| 克隆 + 解包后的工作区 | 可用;以 HEAD 为基准独立算出的 D/M/多出 =136/6/157,与 `git status -uall` 逐条对齐 | 可用;0/3/0 逐条对齐 |

(右侧一列是当时那次的数字;这份快照每天重生成,HEAD 与文件数会变。)

旧三件的去向(体积:meta 3.5MB / mirror 88MB / worktree 109MB,共约 200MB):
meta 的 7 个文件原样收进 `2026-10-05/legacy-meta/`;mirror 与 worktree 被重新打包成
`2026-10-05/{repo.bundle, worktree.tar.zst}`(17MB)并通过上表演练;确认后旧目录已删除。
mirror 比可达历史大出来的部分是仓库里**已不可达的对象**(`git fsck --unreachable`:7883 个
被丢掉的 stash 提交及其 trees/blobs),`git bundle` 不收这类对象。复核:同一批对象在活库
`F:/0-Note/.git` 里仍在(同口径统计 8695 个不可达 commit),而活库在 `notes` 集合里 —— 所以没丢东西。

`F:` 根上的两个散落文件(2026-09-23 的 bundle ×2)已移入 `%NOTE_BACKUP_ROOT%/legacy/`
并记 sha256;根上那份 `0-Note-backup-2026-10-05-diff-HEAD.patch` 与 `legacy-meta/diff-HEAD.patch`
逐字节相同,删掉了重复的那份。

### 1.6 备份待决策项

1. **快照落哪**(推荐:**跨 provider 对象存储** R2/B2,两台机器各一个 restic 仓库;
   退而求其次腾讯云 COS)。定了之后填 `config/backup.json` 的 `restic.repository` /
   `restic.passwordFile`,或设 `RESTIC_REPOSITORY` / `RESTIC_PASSWORD_FILE`。
2. **密码文件放哪**(推荐:**不放被备份的那台机器**。密码管理器存一份 + 离线纸质/硬件密钥存一份;
   本机 `~/.config/automation-suite/restic-password`(600)只能算其中一份,且已从 `credentials` 集合
   排除,不进任何快照。**丢了密码 = 所有快照永久不可读**,restic 没有后门)。
3. **跑多勤**(已定:**每天一次,22:00 之后** —— 接在 AutoShutdown0200 之前)。
4. **`.capture/`(621MB 逆向抓取产物)要不要留**(已定:**不备**,已从清单移除)。
5. **`~/.ai-sessions`(71MB 心跳注册表)值不值得备**(已定:**不备**,已从清单移除)。
6. **magic-context 的活库怎么备**(已定:**`VACUUM INTO` 快照**,实现见 `prepare` 段与
   `scripts/lib/backup-prepare.mjs`)。

---

## 2. 通知中间层(apprise)

### 2.1 现状与实测

- **apprise 已经装着**:`Apprise v2.0.0`,来自 scoop 的 Python(`~/scoop/apps/python/current/Scripts/apprise`)。
- 它**原生支持企业微信群机器人**:`apprise --details` 列出 `wecombot` schema,
  `apprise --dry-run "wecombot://<key>"` 解析通过。也就是说它与现有发送层是**同一个通道**。
- 现有实现是三份独立的 `wecom-core`(微软积分 Node、微信读书 Python、Epic Node),
  由 `scripts/check-wecom-drift.mjs` 锁住**逐字节一致**;契约写在
  [wecom-rules.md](wecom-rules.md):字节级截断、超时、重试、`errcode` 处理、脱敏。

### 2.2 上不上

| | 换 apprise | 保持现状 |
| --- | --- | --- |
| 好处 | 一处配置多通道(企业微信 + ntfy + 邮件);重试/去重是现成的;新增程序不用再抄 `wecom-core` | 契约已在文档里写死并有漂移检测;消息排版在程序侧,完全可控;无额外进程 |
| 代价 | 要为 `wecom-core` 的字节截断语义重新做人;每发一条要起一个 Python 进程(约 200-400ms);`check-wecom-drift.mjs` 得重写或废弃;三份实现与文档 [wecom-rules.md](wecom-rules.md) 要同步改 | 新增通道要再写一遍发送层 |

**结论:三个套件程序不动。** 换过去唯一的真实收益是「多通道」,而现在不需要;
代价是把一个已经被检测锁死的稳定层重做一遍。
**新基础设施(备份失败、更新失败、监控告警)可以直接用 apprise**,因为那些还没有任何发送层 ——
这是它的正确用法,也是它能力的下限。

工作量:若将来真要换,约 1 天(改文档 + 三处实现 + 重写漂移检测 + 联调)。

---

## 3. 更新(topgrade)

### 3.1 已装,且实测过

`topgrade 17.12.3`(scoop 装)。真跑 `--dry-run` 看到的完整步骤清单:

```
self_update · wsl · chocolatey(标准跳过) · scoop · winget · rustup · cargo · pi ·
vscode(扩展) · miktex · pip3 · helix · npm · yarn · pnpm · containers(本机必失败) ·
github_cli_extensions · claude_code · claude_code_plugins · skills · platformio_core · uv
```

### 3.2 为什么不能裸跑

- **`pi` 那一步是 `pi update`。** 按本仓库的既定规则,`pi update` 之后必须重跑
  `config-ai/setup.sh`(重种扩展依赖 + 重打 dist 补丁)。无人值守升完不补,
  等于把已部署配置留在半旧状态。
- **`npm` / `pnpm` / `yarn` 的全局更新**会动 `pi` 扩展包、`claude`、`opencode` 这些 CLI,
  升完要人工验证;`containers` 因为 Docker Desktop 常没起,只会报错刷屏;
  `chocolatey` 没有 gsudo,必然 SKIPPED。

### 3.3 收窄配置(已实测有效)

`config/topgrade.example.toml` —— 拷成 `%APPDATA%\topgrade.toml` 后,`--dry-run` 只剩 5 条命令:

```
scoop update / scoop update '*' / winget source update / winget upgrade --all --silent /
gh extension upgrade --all
```

踩过的坑:步名必须用 topgrade 自己的名字 —— **npm 那一步叫 `node`**,写 `npm` 会让整个配置
TOML 反序列化失败(而且只在启动时报一行 ERROR,容易被当成没生效);`wsl` 与 `wsl_update`
是两个独立步骤,要分别关。

### 3.4 待决策

1. **要不要把 topgrade 放进计划任务**(推荐:先手动跑几次;要进就配收窄配置 + `assume_yes = true`,
   频率每周一次)。
2. **`pi` / `npm` 这两步要不要在收窄配置里放开**(推荐:不放开 —— 它们需要配置补部署,
   不适合无人值守)。

---

## 4. 监控(changedetection.io / RSSHub)

### 4.1 三种跑法的代价

| 跑法 | 代价 | 结论 |
| --- | --- | --- |
| 本机原生(Windows) | changedetection 是 Python Web 应用,常驻约 150-300MB;RSSHub 是 Node 服务,常驻约 100-200MB。本机实测 15.7GB 内存、跑测试时仅剩 2.9GB | 可行但没必要:它们是需要长期在线的服务,本机不是 |
| 本机 Docker Desktop | Docker Desktop 在 Windows 上要一个 WSL2 虚拟机,**光空载就 1-2GB**,再加两个容器 | **不建议**:本机内存最紧,收益最小 |
| **云主机的 docker compose** | 腾讯云主机 4 核 3.7GB / 盘剩 50GB;两个容器合计约 300-500MB | **推荐**,且符合既定的「服务器上非 AI 项目一律 Docker」规则 |

### 4.2 建议与最小可用配置(不实施)

- 位置:腾讯云主机 `/srv/apps/{changedetection,rsshub}/{compose.yaml,.env,data/}`。
- 端口按既有规则:`IP:端口` 直连,`ufw` + `DOCKER-USER` 链放行。
- 通知出口:两个容器都支持自定义 webhook —— 直接指向**企业微信群机器人**即可,
  不必先引 apprise(除非同时要第二个通道)。
- changedetection 的最小用途:商品降价/补货、页面改版;RSSHub 的最小用途:把无 RSS 的站点
  接成 feed 再转企业微信。
- **本机 counterparts**:不需要。本机只保留「生成变更」的脚本,消费方在云上。

### 4.3 待决策

1. **是否现在上**(推荐:先上 RSSHub 一个,验证「RSS -> 企业微信」这条链;changedetection 按需再加)。
2. **要不要 uptime-kuma**(推荐:暂时不要,与 changedetection 有重叠,且本机没有对外服务可监控)。

---

## 5. 待决策清单(汇总,逐条附推荐)

| # | 决策 | 推荐 / 现状 |
| --- | --- | --- |
| 1 | restic 快照落哪 | **跨 provider 对象存储**(R2 / B2),两台机器各一仓库;次选腾讯云 COS。**不要**放云主机自己或同账号同区域 |
| 2 | restic 密码文件放哪 | 密码管理器 + 离线纸质/硬件各一份;本机 `~/.config/automation-suite/restic-password`(600,已从 `credentials` 集合排除)。丢了密码 = 快照全废 |
| 3 | 备份频率 | **已定:每天一次,22:00 之后**、AutoShutdown0200 之前 |
| 4 | 621MB `.capture/` 备不备 | **已定:不备**(已从清单移除) |
| 5 | 备份里要不要含 `~/.ai-sessions`(71MB 心跳) | **已定:不要**(已从清单移除) |
| 6 | magic-context 活库怎么备 | **已定:`VACUUM INTO` 快照**(`prepare` 段已实现,实测 198MB) |
| 7 | 要不要给 `Zzz210s/note` 推那 26 个提交 | **暂缓**:只读检查发现未推提交里含生产机 IP `62.234.211.51`(56 处)与本机用户目录路径(`%USERPROFILE%` 形式)等,而远端是 public;先脱敏(IP→`<服务器IP>`、用户名→占位)再推,或转私有(会断公开 Pages) |
| 8 | 通知层换不换 apprise | 不换;apprise 只给新基础设施用 |
| 9 | topgrade 进不进计划任务 | 先进手动阶段;要进就配 `config/topgrade.example.toml` |
| 10 | 监控放哪 | **云主机 docker compose**,不在本机 |
| 11 | 先上 RSSHub 还是 changedetection | **RSSHub**(链路更短,风险更低) |

---

## 6. 复核命令

```bash
# 备份清单:枚举本机会备份什么(不需要 restic、不需要 npm install;不连远端)
node scripts/backup.mjs

# 只核查「本机清单里写的路径都还在」
node scripts/backup.mjs --strict

# 通过 SSH 只读枚举云上要备份什么(需要 BACKUP_REMOTE_SSH;只跑 du/find/stat,不传文件)
node scripts/backup.mjs --remote

# 打印从云上拉取的 rsync 命令(不执行)
node scripts/backup.mjs --pull

# 笔记库快照:看计划 / 生成 / 列出 / 恢复演练(演练不通过就不要删任何旧件)
node scripts/note-snapshot.mjs
node scripts/note-snapshot.mjs --apply
node scripts/note-snapshot.mjs --list
node scripts/note-snapshot.mjs --drill=<日期> --source=<原始工作区目录>

# 纯函数回归(脱敏规则 + 快照保留策略/差异分类/tar 路径)
node --test "scripts/test/*.test.mjs"

# 更新工具:看会升什么,不真升
topgrade --dry-run --config config/topgrade.example.toml

# 通知中间层能不能解析企业微信地址
apprise --dry-run -t t -b b "wecombot://<key>"
```
