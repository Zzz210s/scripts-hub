# 文档索引

跨项目的约定与总览都在这里;单项目细节在各自目录的 README 里;本机部署现状在 `machine/`。

| 文档 | 回答什么问题 | 什么时候看 |
| --- | --- | --- |
| [workspace-model.md](workspace-model.md) | 每个项目的权威工作区在哪、改了代码怎么进仓库、为什么不用 submodule 与子目录 origin | 第一次改代码前,或想知道「为什么不能直接改项目目录」 |
| [automation-overview.md](automation-overview.md) | 三个程序各是什么、代码在哪、跑在哪、被哪个仓库管理 | 第一次进仓库,想先看全貌 |
| [scheduling-convention.md](scheduling-convention.md) | 什么时候跑、怎么错峰、两段守卫与单实例锁如何工作;本机版与云端版 | 改触发时间、加新程序、排查「为什么这次没跑」 |
| [notification-convention.md](notification-convention.md) | 会发哪几种企业微信消息,每种长什么样,文案有哪些硬规则 | 改消息内容或新增消息类型 |
| [cloud-vm.md](cloud-vm.md) | 为什么要一台云主机、评估过哪些替代方案、代价是什么 | 考虑云迁移,或想知道现在为什么还没上云 |
| [credentials.md](credentials.md) | 哪个文件要填什么、去哪拿、有效期多久、失效后怎么恢复 | 初次部署、凭据失效、换机恢复 |

不在 `docs/` 里的:

- 本机计划任务清单与停用命令:`../machine/scheduled-tasks.md`
- 本机微信读书部署现状:`../machine/weread-deployment.md`
- 上游补丁存档与说明:`../patches/`
- 开通与同步向导:`../scripts/README.md`
