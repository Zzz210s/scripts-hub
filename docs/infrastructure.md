# 基础设施:备份 / 通知中间层 / 更新 / 监控

这份文档回答的是「自动化套件之外,还缺什么底座」,不是某个程序怎么跑。
调研来源:笔记库里的 `记录/自动化脚本项目/2026-10-06-可加入的自动化脚本调研.md` 的「强烈建议」档
(备份、通知中间层、更新、监控四项)。**下列结论多数带待决策项,只有明确标注「已做」的才动过本机。**

---

## 0. 一句话结论

| 方向 | 结论 | 状态 |
| --- | --- | --- |
| 备份 | 用 **restic**,目标先落**腾讯云主机**(SFTP),清单与脚本已就绪 | 脚本已做并实测,目标待定 |
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
| 笔记库 `%NOTES_DIR%` | 98MB / 6562 文件 | GitHub `Zzz210s/note`(**public**) | 半个:144 个未提交改动 + 26 个未推提交不在远端 |
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

### 1.4 目标位置选项

| 选项 | 成本 | 风险 | 备注 |
| --- | --- | --- | --- |
| **腾讯云主机 SFTP**(已有,地址见 `~/.ssh/config`) | 0(已付费) | 单点云主机,但已在异地;盘剩 50GB,放 2GB 上下的快照够用 | **推荐先落这里**。restic 支持 `sftp:` 后端,只要放一个 `restic serve`/SFTP 目录 |
| rclone 云盘(OneDrive / 对象存储) | 免费额度或几元/月 | 需要 OAuth 配置;免费额度有 API 限流 | 次选,适合当第二份 |
| 移动硬盘 / U 盘 | 一次性买盘(¥100-300) | 需要人记得插;不插就没有 | 适合做「离线第三份」 |
| 第二个 git 远端(私有仓) | 0 | 只覆盖 git 仓库;会话与凭据进不去 | 只解决 `ai-session-hub` 那 11 个未推提交,不是备份方案 |
| NAS | 需要买设备 | 一次性投入最高 | 不必要 |

**注意:不要选 D:、E:、F: 上的任何位置** —— 它们与 C: 同盘。

### 1.5 已经做掉的

- `config/backup.json` —— 清单:6 个集合(`credentials` / `agent-memory` / `notes` /
  `workspaces` / `repos` / `weread-capture`),每项写清「为什么它需要被备份」。
  排除项按目录名走:`.capture`、`node_modules`、`.venv`、`__pycache__`、`.codegraph`、
  `ms-playwright`、`logs`、`tmp`、`.cache` 等。
- `scripts/backup.mjs` + `scripts/lib/backup.mjs` —— 枚举与执行。**默认 `--dry-run`**,
  不需要 restic 也不需要 `npm install`;`--apply` 在没有仓库参数时**故意拒绝执行**。

```bash
node scripts/backup.mjs                 # 枚举会备份什么(已实测)
node scripts/backup.mjs --list          # 看有哪些集合
node scripts/backup.mjs --json          # 机器可读
node scripts/backup.mjs --set=notes     # 只看一个集合
node scripts/backup.mjs --strict        # 有缺失就退出 1
```

实测输出:`29/30 个来源存在,约 2.04 万个文件,1.7GB,1 个缺失`。缺失的是
`proj-epic-free-games/secrets/`(还没建)。
清单里的路径不写死盘符:`%NAME%` 从环境变量或机器私有的 `~/.config/automation-suite/local-paths.env`
展开(`NOTES_DIR` 是本轮新增的键),所以仓库里不会出现本机绝对路径。

### 1.6 备份待决策项

1. **快照落哪**(推荐:腾讯云主机 SFTP 目录 `~/backups/restic`)。定了之后填
   `config/backup.json` 的 `restic.repository` / `restic.passwordFile`,或设
   `RESTIC_REPOSITORY` / `RESTIC_PASSWORD_FILE`。
2. **密码文件放哪**(推荐:`~/.config/automation-suite/restic-password`,600,且**它本身不进备份** ——
   丢了密码等于丢了所有快照)。
3. **`.capture/`(621MB 逆向抓取产物)要不要留**(推荐:默认不留,`--include-optional` 可加回)。
4. **跑多勤**(推荐:每天一次,接在 22:00 之后、AutoShutdown0200 之前)。
5. **magic-context 的活库怎么备**(`context.db` 735MB + WAL;热拷贝可能不一致。
   推荐:备份前先 `VACUUM INTO` 一份快照文件,或接受 restic 读取时的轻微不一致 —— 待定)。
6. **`~/.ai-sessions`(71MB 心跳注册表)值不值得备**(推荐:不值得,可重建;现在在清单里,可以删)。

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

| # | 决策 | 推荐 |
| --- | --- | --- |
| 1 | restic 快照落哪 | 腾讯云主机 SFTP 目录,`~/backups/restic` |
| 2 | restic 密码文件放哪 | `~/.config/automation-suite/restic-password`(600,本身不入备份) |
| 3 | 备份频率 | 每天一次,22:00 之后、AutoShutdown0200 之前 |
| 4 | 621MB `.capture/` 备不备 | 默认不备,需要时 `--include-optional` |
| 5 | 备份里要不要含 `~/.ai-sessions`(71MB 心跳) | 不要,可重建(现在在清单里,可删) |
| 6 | magic-context 活库怎么备 | 备份前 `VACUUM INTO` 快照,避免 WAL 不一致 |
| 7 | 要不要给 `Zzz210s/note` 推那 26 个提交 | 要(公开仓,推前先确认里面没有敏感内容;或改为私有仓) |
| 8 | 通知层换不换 apprise | 不换;apprise 只给新基础设施用 |
| 9 | topgrade 进不进计划任务 | 先进手动阶段;要进就配 `config/topgrade.example.toml` |
| 10 | 监控放哪 | 云主机 docker compose,不在本机 |
| 11 | 先上 RSSHub 还是 changedetection | RSSHub(链路更短,风险更低) |

---

## 6. 复核命令

```bash
# 备份清单:枚举会备份什么(不需要 restic、不需要 npm install)
node scripts/backup.mjs

# 只核查「清单里写的路径都还在」
node scripts/backup.mjs --strict

# 更新工具:看会升什么,不真升
topgrade --dry-run --config config/topgrade.example.toml

# 通知中间层能不能解析企业微信地址
apprise --dry-run -t t -b b "wecombot://<key>"
```
