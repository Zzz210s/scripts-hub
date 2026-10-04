# 工作模型:权威工作区与同步落点

本仓库不是单一程序,而是**多个完整项目的合集**:每个项目一个隔离子目录,各带自己的 README、
依赖清单、测试入口与许可。同时,它还是两个**没有 origin 的权威工作区**的远程落点。

这篇说明改了代码之后到底在哪改、怎么进仓库、为什么这样设计。改任何项目前先读这一篇。

## 1. 每个项目的权威工作区在哪

| 项目 | 权威工作区(改代码的地方) | 本仓库落点 | 怎么进仓库 |
| --- | --- | --- | --- |
| 微软积分 | `%REWARDS_DIR%`(本机本地 git 仓库,只有 upstream 远端) | `proj-microsoft-rewards/` | `bash scripts/sync-microsoft-rewards.sh` |
| 微信读书签到 | `%WEREAD_DIR%`(本机本地克隆,无远端) | `proj-weread-signin/` | `bash scripts/sync-weread-signin.sh` |
| 智慧树刷课 | 无代码可改:程序本体是上游 Windows 打包程序,本仓库只存配置 | `proj-autovisor/`(只有 `configs.ini` 与 README) | 直接改配置 |
| Epic 限免领取 | 代码就在本仓库 `proj-epic-free-games/`(薄壳自研 + 上游引擎快照),不要另建工作区 | 同左 | 直接改;上游引擎按 `proj-epic-free-games/VENDOR_COMMIT.txt` 重新取文件升级 |

企业微信发送不再是独立项目:实现分散在各项目内,共享约束与规则见
[`docs/wecom-rules.md`](wecom-rules.md),一致性由 `scripts/check-wecom-drift.mjs` 守住。

***换机后,`%REWARDS_DIR%` 与 `%WEREAD_DIR%` 就是要从本仓库恢复出来的目录。***

## 2. 改了代码之后

以微软积分为例:

```bash
cd "%REWARDS_DIR%"           # 1. 在权威工作区改代码并提交
# ...编辑 src/ 或 scripts/windows/ 或 wechat-bridge/...
git add <显式路径> && git commit

cd <hub>                     # 2. 发布成本仓库的快照
bash scripts/sync-microsoft-rewards.sh        # 先 --dry-run 看差异也行
git add proj-microsoft-rewards && git status     # 3. 复核后提交推送
git commit && git push
```

微信读书把脚本换成 `scripts/sync-weread-signin.sh`,落点换成 `proj-weread-signin/`,流程一样。

**不要直接改 `proj-microsoft-rewards/` 或 `proj-weread-signin/` 里的文件** —— 它们是生成快照,下次同步会
覆盖回去。要改的说明文档、约定、补丁不进快照:

- 跨项目约定 → `docs/`
- 本机部署现状 → `docs/local-deployment.md`
- 上游补丁 → `patches/`(每个项目快照里不再放 `patches/`)
- 开通、同步、漂移检测脚本 → `scripts/`

## 3. 为什么不是 submodule,也不是「origin 指子目录」

- **git 不能把某个仓库的 origin 指到另一个仓库的子目录。** 远端是仓库级概念,不存在「子目录远程」。
  所以「origin 在 scripts-hub 的对应文件夹」只能靠**同步脚本**实现:它把权威工作区里 `git ls-files`
  列出的已跟踪文件发布成快照,在快照里提交推送。脚本承担的就是这两个工作区的 `push` 角色。
- **不用 submodule。** submodule 要求被挂载的项目有自己的远端仓库;而这两个权威工作区没有远端
  (微软积分只有 upstream、微信读书没有 remote),也明确不打算为它们再建独立仓库。挂一个没远端的
  本地仓库进另一个仓库,只会得到不能克隆、不能推送的空壳。
- **快照只含已跟踪文件。** 凭据(`.env`、`secrets/`)、运行数据(`sessions/`、`logs/`、`data/`)、
  构建产物(`dist/`、`node_modules/`)一律不进仓库。同步脚本还会做去本机化(绝对路径 → 占位符)
  与脱敏(个人标识 → `sample`),每个快照的 `SNAPSHOT.txt` 记录源提交与改写规则。

## 4. 同步脚本索引

| 脚本 | 权威工作区 | 落点 | 关键行为 |
| --- | --- | --- | --- |
| `scripts/sync-microsoft-rewards.sh` | `%REWARDS_DIR%` | `proj-microsoft-rewards/` | 发布 `git ls-files` + 白名单 `config.json`;跳过 `patches/` 与测试垃圾;`README.md` 发布为 `README.upstream.md`;去本机化 + 脱敏(缺机器私有清单直接报错) |
| `scripts/sync-weread-signin.sh` | `%WEREAD_DIR%` | `proj-weread-signin/` | 发布 `git ls-files`;README 顶部重写快照说明;机器相关的 `WORKSPACE.md` 不发布 |

两个脚本都带 `--dry-run`(只报告差异)、都写 `SNAPSHOT.txt`(记录源提交),都可重复运行(幂等)。

`proj-epic-free-games/` **没有**对应的 `sync-*` 脚本:它的权威副本就在本仓库里(与 `proj-autovisor/` 同类),
所以没有「工作区 -> 仓库」这个方向。将来若把它拆成独立工作区,同步脚本照
`scripts/sync-weread-signin.sh` 的形态写(发布 `git ls-files` + 写 `SNAPSHOT.txt`)。

## 5. 项目隔离规则

- 每个项目目录**自带** README、依赖清单、测试入口、许可(`LICENSE` 或指向根 `LICENSE` 的说明)。
- 项目之间**不共享代码**,也不做跨项目的相对路径引用;需要通知层这类共同逻辑时**内嵌同一块**并靠
  `scripts/check-wecom-drift.mjs` 锁住逐字节一致(不是 import 另一个项目)。
- `docs/`、`patches/`、`scripts/` 属于**合集层**,项目目录里不再复制它们的职责内容。
- 一个项目一个目录,目录名对应程序或组件,不按语言或文件类型分层。

## 6. 相关文档

- 全貌与调度:`docs/automation-overview.md`
- 脚本索引与用法:`scripts/README.md`
- 补丁存档:`patches/README.md`
- 凭据清单:`docs/credentials.md`
