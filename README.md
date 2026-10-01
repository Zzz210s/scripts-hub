# 本机自动化程序的配置方案

本仓库保存这台机器上三个自动化程序的**配置方案**(配置模板、调度方式、日志位置、排错笔记),不含任何真实凭据。

## 三个程序

| 程序 | 作用 | 程序位置 | 配置在本仓库的位置 |
| --- | --- | --- | --- |
| **微软积分** | 每天自动跑 Microsoft Rewards(搜索、活动、读文章),算完分推送到企业微信 | `%REWARDS_DIR%` | `microsoft-rewards/` |
| **智慧树刷课** | Autovisor,自动播放智慧树/知到的网课视频 | `%AUTOVISOR_DIR%\app` | `autovisor/` |
| **微信读书签到** | 每天自动完成微信读书阅读挑战的打卡(读满当日所需时长) | 待建 `%WEREAD_DIR%` | `weread-signin/` |

## 目录说明

```
microsoft-rewards/   微软积分:账号模板、config.json、运行器脚本、调度说明、补丁存档
autovisor/           智慧树:configs.ini(含课程链接,不含账号密码)
weread-signin/       微信读书:选型结论、架构与开发顺序(项目未落地)
tasks/inventory.md   本机计划任务清单:名称、触发、作用、怎么停用
secrets/README.md    哪些值要填、去哪里拿(只写说明,不写值)
```

## 通用规则

- **真实凭据永不入库**:`.env`、cookie、webhook、API Key 只留在本机各程序的目录里;本仓库只有模板和说明(`.gitignore` 已排除)。
- **调度方式统一**:Windows 计划任务 + 隐藏窗口启动器(`wscript` 调 `.vbs`)+ 单实例锁 + 一天一次守卫 + 失败重试 + 看门狗超时强杀。
- **通知统一**:企业微信群机器人 webhook(`wecom-notify` 或程序内嵌实现)。
- **运行数据统一**:状态与日志都写在程序目录下的 `logs/`、`data/` 或 `sessions/`,不入库。

## 在新机器上恢复

1. 克隆本仓库(私有,需要 `gh auth login` 或带 token)
2. 装程序本体:微软积分用上游 release 解压到 `%REWARDS_DIR%`,智慧树用 `%AUTOVISOR_DIR%` 里的 zip 重新解压
3. 按各子目录的 README 恢复配置(把仓库里的模板/配置复制到程序目录)
4. 按 `secrets/README.md` 填真实凭据
5. 按 `microsoft-rewards/README.md` 重新注册计划任务(或运行 `scripts-windows/install-autostart.bat`)
6. 用 `tasks/inventory.md` 里的命令核对任务状态
