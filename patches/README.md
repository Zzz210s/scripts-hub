# 上游补丁存档

本仓库对上游项目做的所有改动都放这里,**按上游项目分目录**。规矩只有一条:补丁跟它修改的上游走,
不散落在项目目录里;哪个补丁是否被应用,由下面这张表和每个目录自己的 README 说清。

| 目录 | 上游项目 | 内容 | 是否应用 |
| --- | --- | --- | --- |
| `microsoft-rewards/` | [`TheNetsky/Microsoft-Rewards-Script`](https://github.com/TheNetsky/Microsoft-Rewards-Script) v4.3.2(GPL-3.0) | 三个针对上游 TypeScript 源码的补丁:每日集快照重试 + 移动端刷新健壮性 + `rewards-context` 健壮性 | **是**,升级上游后按文件名顺序 `git apply`;不应用则每日集可能白丢 30 分/账号,移动端登录卡死后会中断整个账号 |
| `weread-bot/` | [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot)(MIT) | PR #53 的完整 diff 与 fork 结局说明 | **否**,仅作存档;fork 已于 2026-10-04 删除、PR #53 随之关闭,补丁可从同一上游重新 fork 后 `git apply`;底座固定在 `0cc9b5c`(见 `../proj-weread-signin/VENDOR_COMMIT.txt`) |

## `microsoft-rewards/` 的三个补丁

| 文件 | 修什么 |
| --- | --- |
| `v4.3.2-earn-snapshot-daily-set.patch` | `/earn` 与 `/dashboard` 快照抓取失败时重试,并在执行活动前再刷新一次快照 —— 修并行运行时「每日集 3 项被判为不存在」导致的白丢分 |
| `v4.3.2-mobile-reload-robustness.patch` | 移动端刷新撞上在途导航 / 错误页 / 连接被重置时重试并退回当前 URL 导航,不再让一次 `net::ERR_ABORTED` 中断整个账号运行 |
| `v4.3.2-rewards-context-robustness.patch` | 让奖励页上下文解析在缺少 flight 数据时更健壮 |

应用方式(在 `%REWARDS_DIR%` 里,按文件名顺序;`<hub>` 指本仓库的克隆路径):

```bash
cd "%REWARDS_DIR%"
git apply <hub>/patches/microsoft-rewards/*.patch
```

本目录的补丁是**权威存档**;`../proj-microsoft-rewards/` 项目快照里不再放 `patches/`(脚本
`../scripts/sync-microsoft-rewards.sh` 会跳过它),避免同一份补丁两处维护。恢复整套微软积分
部署时,把 `../proj-microsoft-rewards/` 的已跟踪文件同步进 `%REWARDS_DIR%`,再把本目录三个补丁按顺序
`git apply` 上去,然后 `npm install && npm run build`。

## `weread-bot/`

fork `Zzz210s/weread-bot` **已于 2026-10-04 删除**,开放中的 PR #53 因此被关闭。补丁仍完整存于
本目录;需要重新提交时从同一上游重新 fork、`git apply` 本补丁即可。删除前的覆盖验证、镜像备份位置
与重新提交步骤见 [`weread-bot/README.md`](weread-bot/README.md)。
