# 文档索引

跨项目的约定与总览都在这里;单项目细节在各自目录的 README 里。

| 文档 | 回答什么问题 | 什么时候看 |
| --- | --- | --- |
| [workspace-model.md](workspace-model.md) | 每个项目的权威工作区在哪、改了代码怎么进仓库、为什么不用 submodule 与子目录 origin | 第一次改代码前,或想知道「为什么不能直接改项目目录」 |
| [automation-overview.md](automation-overview.md) | 三个程序各是什么、代码在哪、跑在哪、被哪个仓库管理 | 第一次进仓库,想先看全貌 |
| [local-deployment.md](local-deployment.md) | 本机部署现状:权威工作区、计划任务、入口脚本、运行器守卫、本机私有文件 | 换机恢复、排查「为什么没跑」、改运行器前 |
| [scheduling-convention.md](scheduling-convention.md) | 什么时候跑、怎么错峰、两段守卫与单实例锁如何工作;本机版与云端版 | 改触发时间、加新程序、排查「为什么这次没跑」 |
| [notification-convention.md](notification-convention.md) | 会发哪几种企业微信消息,每种长什么样,文案有哪些硬规则 | 改消息内容或新增消息类型 |
| [wecom-rules.md](wecom-rules.md) | 企业微信 webhook 的共享约束:接口形态、字节上限与截断、超时与重试、errcode 处理、发送频率,以及各项目实现的位置 | 改发送层、调消息长度或排查发送失败 |
| [cloud-vm.md](cloud-vm.md) | 为什么要一台云主机、评估过哪些替代方案、代价是什么 | 考虑云迁移,或想知道现在为什么还没上云 |
| [credentials.md](credentials.md) | 哪个文件要填什么、去哪拿、有效期多久、失效后怎么恢复 | 初次部署、凭据失效、换机恢复 |

不在 `docs/` 里的:

- 上游补丁存档与说明:`../patches/`
- 向导、快照同步、部署脚本与检查脚本:`../scripts/README.md`
