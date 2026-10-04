# weread-bot 上游补丁与 fork 说明

这个目录只做两件事:**存一份上游贡献用的补丁**(便于换机恢复与溯源),以及**记清那个 fork 的结局**。
这里的文件不参与本仓库任何程序的运行,`proj-weread-signin/` 也不依赖它。

## 补丁

| 文件 | 内容 |
| --- | --- |
| `pr-53-cookie-persist-after-renewal.patch` | PR #53 的完整 diff,由 fork 的 `fix/cookie-persist-after-renewal` 分支按 `git diff main...<分支>` 生成 |

来源与版本信息写在补丁文件头的注释里(源仓库、分支、base/head commit、PR 链接)。应用方式:
在上游 `0cc9b5c` 的工作树上先 `git apply --check` 再应用。**仅作存档**,`proj-weread-signin/` 的底座仍
按 `proj-weread-signin/VENDOR_COMMIT.txt` 固定在 `0cc9b5c`(未含此补丁)。

## 那个 fork:`Zzz210s/weread-bot` —— 已于 2026-10-04 删除

`https://github.com/Zzz210s/weread-bot` 曾是 [`funnyzak/weread-bot`](https://github.com/funnyzak/weread-bot)
的 fork(MIT),用途是向上游提交补丁。它当初**有意保留**是因为 `fix/cookie-persist-after-renewal`
分支是开放中 PR #53 的 head;2026-10-04 决定删除并归拢内容,于是:

- **删除前已确认内容全部有别的落点**:fork 的 `main` 与上游 `funnyzak/weread-bot` 的 `main` 同为
  `0cc9b5c`(没有自研改动);真正有价值的是 `fix/cookie-persist-after-renewal`,其完整 diff 已按
  `git diff main...<分支>` 逐字节存进 `pr-53-cookie-persist-after-renewal.patch`(复核过与分支一致)。
- **删除前做了镜像备份**:`%USERPROFILE%\weread-bot-backup-2026-10-04.git`(`git clone --mirror`,
  含 5 个分支与全部 tag;`git fsck` 无错)。
- **删除的后果**:PR #53 的 head 分支随 fork 消失,**PR #53 因此被关闭**
  (`state=CLOSED`,`closedAt=2026-10-04T07:25:37Z`)。上游 issue #52 与本次删除无关,仍按原状存在。

### 需要重新提交时

从同一上游重新 fork,把本目录的补丁应用上去:

```bash
gh repo fork funnyzak/weread-bot --clone
cd weread-bot
git checkout -b fix/cookie-persist-after-renewal 0cc9b5c
git apply --check <本仓库>/patches/weread-bot/pr-53-cookie-persist-after-renewal.patch
git apply <本仓库>/patches/weread-bot/pr-53-cookie-persist-after-renewal.patch
git commit -am "fix: 凭据续期后把新 cookie 原子写回来源文件"
git push -u origin fix/cookie-persist-after-renewal
gh pr create --repo funnyzak/weread-bot --base main --head <你的账号>:fix/cookie-persist-after-renewal
```

### 补丁在解决什么

底座的 `_refresh_cookie` 续期成功后只更新内存里的 `wr_skey`,不写回任何文件;进程重启后仍用旧
cookie,需要人工介入。补丁在 cookie 来源是文件时,把新值原子写回该文件(只替换变化的值),来源
不是文件时行为不变。它同时是 `proj-weread-signin/` 自研代码里凭据续期落盘逻辑的上游对应物。
