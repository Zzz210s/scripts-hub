# weread-bot 上游补丁与 fork 说明

这个目录只做两件事:**存一份上游贡献用的补丁**(便于换机恢复与溯源),以及**写清那个 fork 为什么不能删**。
这里的文件不参与本仓库任何程序的运行,`weread-signin/` 也不依赖它。

## 补丁

| 文件 | 内容 |
| --- | --- |
| `pr-53-cookie-persist-after-renewal.patch` | PR #53 的完整 diff,由 fork 的 `fix/cookie-persist-after-renewal` 分支按 `git diff main...<分支>` 生成 |

来源与版本信息写在补丁文件头的注释里(源仓库、分支、base/head commit、PR 链接)。应用方式:
在上游 `0cc9b5c` 的工作树上先 `git apply --check` 再应用。**仅作存档**,`weread-signin/` 的底座仍
按 `weread-signin/VENDOR_COMMIT.txt` 固定在 `0cc9b5c`(未含此补丁)。

## 那个有意的 fork:`Zzz210s/weread-bot`

`https://github.com/Zzz210s/weread-bot` 是 [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot)
的 fork(MIT)。它**有意保留**,是向上游提交补丁的通道,不属于本 monorepo 的合并范围 ——
`weread-signin/` 合并进来的是这个底座之上的自研代码,不是这个 fork。

### 为什么不能删 / 不能归档 / 不能转移

`fix/cookie-persist-after-renewal` 分支是**开放中 PR #53 的 head**。删除或转移这个 fork 会让
那个 PR 立即失效(上游无法再拉取 head 分支)。所以:**在 PR #53 关闭或合并之前,不要删除、不要归档、
不要把仓库转给别人**。

### 当前状态

查询时间:`2026-10-04`。

| 项 | 值 |
| --- | --- |
| PR #53 | `OPEN`(未评审 `reviewDecision` 为空;`mergeable: MERGEABLE`) |
| PR #53 标题 | `fix: 凭据续期后把新 cookie 原子写回来源文件` |
| PR #53 head | `Zzz210s:fix/cookie-persist-after-renewal` @ `f2f49fa9cbffa97dcd68cf5d7893daf504fd2484` |
| PR #53 链接 | <https://github.com/funnyzak/weread-bot/pull/53> |
| Issue #52 | `open`,1 条评论(我们贴的协议实测结论),最后更新 `2026-10-02` |
| Issue #52 链接 | <https://github.com/funnyzak/weread-bot/issues/52> |

查当前值:

```bash
gh pr view 53 --repo funnyzak/weread-bot --json state,reviewDecision,mergeable
gh api repos/funnyzak/weread-bot/issues/52 --jq '{title,state,comments,updated_at}'
```

### 补丁在解决什么

底座的 `_refresh_cookie` 续期成功后只更新内存里的 `wr_skey`,不写回任何文件;进程重启后仍用旧
cookie,需要人工介入。补丁在 cookie 来源是文件时,把新值原子写回该文件(只替换变化的值),来源
不是文件时行为不变。它同时是 `weread-signin/` 自研代码里凭据续期落盘逻辑的上游对应物。
