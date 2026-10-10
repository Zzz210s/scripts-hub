# Windows 侧运行器(备用入口)

正规入口是仓库根的调度工具:

```
node scripts/apply-schedule.mjs --dry-run      # 看会注册什么
node scripts/apply-schedule.mjs --apply --yes  # 注册 Windows 计划任务
```

它读 `config/schedule.json`,按 `order` 错峰把 B站任务排在第 4 位(默认 09:30 起),
启动 `scripts\windows\run-daily.vbs`。启用前把 `bilibili-tasks.enabled` 改成 `true`
(扫码登录完成之前保持 `false`)。

## 手工跑一次

```
proj-bilibili-tasks\scripts\windows\run-daily.bat
```

或在项目根直接:

```
node src\cli.js run            # 真跑(需要 secrets\cookies.json 与 .NET 环境)
node src\cli.js run --dry-run  # 只打印会发什么,不联网、不起子进程
```

## 这个目录里的文件

| 文件 | 作用 |
| --- | --- |
| `run-daily.vbs` | 计划任务的启动壳:隐藏窗口,把工作目录切到项目根后调用 `run-daily.bat` |
| `run-daily.bat` | 守卫 + 一次运行:单实例、当日配额、内存闸门,然后 `node src\cli.js run` |
| `run-state.js` | `run-daily.bat` 调用的辅助命令:`lock` / `unlock` / `lock-status` / `quota` / `free-mem` / `pids` / `kill` |

`.bat` 的注释**只用 ASCII**:本机 cmd 的 OEM 代码页是 936,UTF-8 中文注释会被逐字节误解析,
把注释片段当命令执行(既有项目 2026-10-05 实测踩过)。

## 锁与状态

- 锁:`data\run.lock`,内容 `{"pid","startedAt"}`。`run-state.js` 的「在跑」判定以进程实况为准
  —— 有没有 `node` 在跑 `src\cli.js`;崩溃留下的残锁会被立刻回收。
- 配额:读 `data\state.json` 里当天的 `attempts`,达到 `BILIBILI_MAX_ATTEMPTS`(默认 2)就 `MET`。
- 内存闸门:低于 800MB 跳过(可用 `BILIBILI_FREE_MEM_MB` 覆盖)。

## 与服务器侧的关系

服务器走的是容器(`scripts/linux/bilibili/`),这份 Windows 运行器只在本机也要跑的时候用;
两者共享同一套 `src/` 与同一份状态格式,但状态文件各自独立。
